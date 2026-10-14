import { loadConfig } from './config.js';
import { createLogger } from './lib/logger.js';
import { InMemoryOrderRepository } from './repositories/orderRepository.js';
import { InMemoryProductRepository } from './repositories/productRepository.js';
import { InMemoryCouponRepository } from './repositories/couponRepository.js';
import { CouponService } from './services/couponService.js';
import { seedDemoData } from './seed.js';
import { createApp } from './server.js';
import { OrderService } from './services/orderService.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel, { service: 'orders-api' });

  const products = new InMemoryProductRepository();
  const coupons = new CouponService({ repository: new InMemoryCouponRepository() });
  const orders = new InMemoryOrderRepository();
  const orderService = new OrderService({
    orders,
    coupons,
    products,
  });

  if (config.seedDemoData) {
    const created = await seedDemoData(products, config.apiKeys);
    logger.info('seeded demo data', { products: created });
  }

  const app = createApp({
    logger,
    apiKeys: config.apiKeys,
    products,
    coupons,
    orderService,
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
