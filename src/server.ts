import express, { type Express } from 'express';
import type { ApiKeyEntry } from './config.js';
import type { Logger } from './lib/logger.js';
import { authenticate } from './middleware/auth.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { requestId, requestLogger } from './middleware/requestContext.js';
import type { ProductRepository } from './repositories/productRepository.js';
import { ordersRouter } from './routes/orders.js';
import { productsRouter } from './routes/products.js';
import type { OrderService } from './services/orderService.js';

export interface AppDeps {
  logger: Logger;
  apiKeys: readonly ApiKeyEntry[];
  products: ProductRepository;
  orderService: OrderService;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');

  app.use(requestId());
  app.use(requestLogger(deps.logger));
  app.use(express.json({ limit: '100kb' }));

  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok' });
  });

  const auth = authenticate(deps.apiKeys);
  app.use('/v1/products', auth, productsRouter(deps.products));
  app.use('/v1/orders', auth, ordersRouter(deps.orderService));

  app.use(notFound);
  app.use(errorHandler(deps.logger));

  return app;
}
