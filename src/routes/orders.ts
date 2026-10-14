import { Router } from 'express';
import { z } from 'zod';
import { SUPPORTED_CURRENCIES } from '../lib/money.js';
import { principalOf, requireRole } from '../middleware/auth.js';
import { idempotency, type IdempotencyOptions } from '../middleware/idempotency.js';
import type { Order } from '../models/order.js';
import type { OrderService } from '../services/orderService.js';
import { asyncHandler } from './asyncHandler.js';

const CreateOrderSchema = z.object({
  customerId: z.string().trim().min(1).max(64),
  currency: z.enum(SUPPORTED_CURRENCIES),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().int().positive().max(1000),
      }),
    )
    .min(1)
    .max(100),
});

export function ordersRouter(service: OrderService, options: { idempotency?: IdempotencyOptions } = {}): Router {
  const router = Router();
  const idempotent = idempotency(options.idempotency);

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const orders = await service.listOrders(principalOf(req));
      res.json({ data: orders.map(serializeOrder) });
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const order = await service.getOrder(principalOf(req), req.params.id);
      res.json({ data: serializeOrder(order) });
    }),
  );

  router.post(
    '/',
    idempotent,
    asyncHandler(async (req, res) => {
      const input = CreateOrderSchema.parse(req.body);
      const order = await service.createOrder(principalOf(req), input);
      res.status(201).json({ data: serializeOrder(order) });
    }),
  );

  router.post(
    '/:id/pay',
    requireRole('admin'),
    asyncHandler(async (req, res) => {
      const order = await service.markPaid(principalOf(req), req.params.id);
      res.json({ data: serializeOrder(order) });
    }),
  );

  router.post(
    '/:id/cancel',
    asyncHandler(async (req, res) => {
      const order = await service.cancelOrder(principalOf(req), req.params.id);
      res.json({ data: serializeOrder(order) });
    }),
  );

  return router;
}

export function serializeOrder(order: Order) {
  return {
    ...order,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    paidAt: order.paidAt?.toISOString(),
    cancelledAt: order.cancelledAt?.toISOString(),
  };
}
