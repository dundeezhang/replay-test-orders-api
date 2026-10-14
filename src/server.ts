import express, { type Express } from 'express';
import type { ApiKeyEntry } from './config.js';
import type { Logger } from './lib/logger.js';
import { authenticate } from './middleware/auth.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { rateLimit, type RateLimitOptions } from './middleware/rateLimit.js';
import { requestId, requestLogger } from './middleware/requestContext.js';
import type { ProductRepository } from './repositories/productRepository.js';
import { checkoutRouter } from './routes/checkout.js';
import type { CheckoutService } from './services/checkoutService.js';
import type { InventoryService } from './services/inventoryService.js';
import { ordersRouter } from './routes/orders.js';
import { productsRouter } from './routes/products.js';
import type { OrderService } from './services/orderService.js';

export interface AppDeps {
  logger: Logger;
  rateLimit?: Pick<RateLimitOptions, 'windowMs' | 'max'>;
  apiKeys: readonly ApiKeyEntry[];
  products: ProductRepository;
  orderService: OrderService;
  checkout?: CheckoutService;
  inventory?: InventoryService;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');

  app.use(requestId());
  app.use(requestLogger(deps.logger));
  app.use(express.json({ limit: '100kb' }));
  app.use(rateLimit(deps.rateLimit));
  // Writes are more expensive than reads, so they get a quarter of the budget.
  app.post('*', rateLimit({ ...deps.rateLimit, max: Math.ceil((deps.rateLimit?.max ?? 120) / 4) }));

  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok' });
  });

  const auth = authenticate(deps.apiKeys);
  app.use('/v1/products', auth, productsRouter(deps.products));
  app.use('/v1/orders', auth, ordersRouter(deps.orderService));
  if (deps.checkout && deps.inventory) {
    app.use('/v1', auth, checkoutRouter(deps.checkout, deps.inventory));
  }

  app.use(notFound);
  app.use(errorHandler(deps.logger));

  return app;
}
