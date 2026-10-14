import { Router } from 'express';
import { z } from 'zod';
import { principalOf } from '../middleware/auth.js';
import type { Reservation } from '../models/reservation.js';
import type { CheckoutService } from '../services/checkoutService.js';
import type { InventoryService } from '../services/inventoryService.js';
import { asyncHandler } from './asyncHandler.js';
import { serializeOrder } from './orders.js';

const CheckoutSchema = z.object({
  paymentMethodToken: z.string().trim().min(3).max(128),
});

/**
 * Mounted under /v1 so the checkout action lives next to the order it acts on
 * (POST /v1/orders/:id/checkout) while inventory lookups get their own paths.
 */
export function checkoutRouter(checkout: CheckoutService, inventory: InventoryService): Router {
  const router = Router();

  router.post(
    '/orders/:id/checkout',
    asyncHandler(async (req, res) => {
      const input = CheckoutSchema.parse(req.body);
      const result = await checkout.checkout(principalOf(req), req.params.id, input);
      res.json({
        data: {
          order: serializeOrder(result.order),
          reservation: serializeReservation(result.reservation),
          chargeId: result.chargeId,
        },
      });
    }),
  );

  router.get(
    '/inventory/:productId',
    asyncHandler(async (req, res) => {
      const availability = await inventory.availability(principalOf(req).merchantId, req.params.productId);
      res.json({ data: availability });
    }),
  );

  router.get(
    '/reservations/:id',
    asyncHandler(async (req, res) => {
      const reservation = await inventory.getReservation(principalOf(req).merchantId, req.params.id);
      res.json({ data: serializeReservation(reservation) });
    }),
  );

  return router;
}

export function serializeReservation(reservation: Reservation) {
  return {
    ...reservation,
    expiresAt: reservation.expiresAt.toISOString(),
    createdAt: reservation.createdAt.toISOString(),
    updatedAt: reservation.updatedAt.toISOString(),
    committedAt: reservation.committedAt?.toISOString(),
    releasedAt: reservation.releasedAt?.toISOString(),
  };
}
