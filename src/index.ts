import { loadConfig } from './config.js';
import { createLogger } from './lib/logger.js';
import { ReservationSweeper } from './jobs/reservationSweeper.js';
import { FakePaymentGateway } from './payments/fakePaymentGateway.js';
import { InMemoryReservationRepository } from './repositories/reservationRepository.js';
import { CheckoutService } from './services/checkoutService.js';
import { InventoryService } from './services/inventoryService.js';
import { InMemoryOrderRepository } from './repositories/orderRepository.js';
import { InMemoryProductRepository } from './repositories/productRepository.js';
import { InMemoryCouponRepository } from './repositories/couponRepository.js';
import { CouponService } from './services/couponService.js';
import { seedDemoData } from './seed.js';
import { createApp } from './server.js';
import { OrderService } from './services/orderService.js';
import { EventBus } from './events/eventBus.js';
import { InMemoryWebhookRepository } from './repositories/webhookRepository.js';
import { DeliveryWorker } from './webhooks/deliveryWorker.js';
import { WebhookService } from './webhooks/webhookService.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel, { service: 'orders-api' });
  const events = new EventBus(logger.child({ component: 'events' }));

  const products = new InMemoryProductRepository();
  const coupons = new CouponService({ repository: new InMemoryCouponRepository() });
  const orders = new InMemoryOrderRepository();
  const orderService = new OrderService({
    orders,
    coupons,
    products,
    events,
  });
  const inventory = new InventoryService({
    products,
    reservations: new InMemoryReservationRepository(),
    logger: logger.child({ component: 'inventory' }),
    reservationTtlMs: config.reservationTtl,
  });
  const checkout = new CheckoutService({
    orders: orderService,
    inventory,
    // TODO: replace with the payments-service client once it exposes charges.
    payments: new FakePaymentGateway(),
    logger: logger.child({ component: 'checkout' }),
  });
  new ReservationSweeper(inventory, logger, config.reservationSweepIntervalMs).start();

  if (config.seedDemoData) {
    const created = await seedDemoData(products, config.apiKeys);
    logger.info('seeded demo data', { products: created });
  }

  const webhookRepository = new InMemoryWebhookRepository();
  const webhooks = new WebhookService({
    repository: webhookRepository,
    events,
    logger: logger.child({ component: 'webhooks' }),
  });
  webhooks.subscribeToDomainEvents();
  new DeliveryWorker({
    repository: webhookRepository,
    logger: logger.child({ component: 'webhook-delivery' }),
    options: {
      pollIntervalMs: config.webhooks.pollIntervalMs,
      batchSize: 50,
      timeoutMs: config.webhooks.timeoutMs,
      maxAttempts: config.webhooks.maxAttempts,
      baseDelayMs: 30_000,
      maxDelayMs: 60 * 60 * 1000,
    },
  }).start();

  const app = createApp({
    logger,
    rateLimit: { windowMs: config.rateLimitWindowMs, max: config.rateLimitMax },
    apiKeys: config.apiKeys,
    webhooks,
    products,
    coupons,
    orderService,
    checkout,
    inventory,
  });

  const server = app.listen(config.port, () => {
    logger.info('orders-api listening', { port: config.port, env: config.nodeEnv });
  });

  const shutdown = (signal: NodeJS.Signals): void => {
    logger.info('shutting down', { signal });
    server.close((err) => {
      if (err) {
        logger.error('error during shutdown', { error: err.message });
        process.exitCode = 1;
      }
      process.exit();
    });
  };

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

main().catch((err: unknown) => {
  console.error('fatal startup error', err);
  process.exit(1);
});
