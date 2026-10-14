import { Router } from 'express';
import { z } from 'zod';
import { SUPPORTED_CURRENCIES } from '../lib/money.js';
import { principalOf, requireRole } from '../middleware/auth.js';
import type { Coupon } from '../models/coupon.js';
import type { CouponService } from '../services/couponService.js';
import { asyncHandler } from './asyncHandler.js';

const CreateCouponSchema = z.object({
  code: z.string().trim().regex(/^[A-Za-z0-9_-]{3,32}$/, 'Codes are 3-32 letters, digits, dashes or underscores'),
  kind: z.enum(['percent', 'fixed']),
  value: z.number().positive(),
  currency: z.enum(SUPPORTED_CURRENCIES).optional(),
  maxRedemptions: z.number().int().positive().optional(),
  expiresAt: z.coerce.date().optional(),
  minSubtotalCents: z.number().int().nonnegative().optional(),
  excludedSkus: z.array(z.string().trim().min(1)).max(100).optional(),
});

export function couponsRouter(service: CouponService): Router {
  const router = Router();

  router.post(
    '/',
    requireRole('admin'),
    asyncHandler(async (req, res) => {
      const input = CreateCouponSchema.parse(req.body);
      const coupon = await service.createCoupon(principalOf(req), input);
      res.status(201).json({ data: serializeCoupon(coupon) });
    }),
  );

  router.get(
    '/:code',
    asyncHandler(async (req, res) => {
      const coupon = await service.getCoupon(principalOf(req), req.params.code);
      res.json({ data: serializeCoupon(coupon) });
    }),
  );

  router.post(
    '/:code/deactivate',
    requireRole('admin'),
    asyncHandler(async (req, res) => {
      const coupon = await service.deactivate(principalOf(req), req.params.code);
      res.json({ data: serializeCoupon(coupon) });
    }),
  );

  return router;
}

function serializeCoupon(coupon: Coupon) {
  return {
    ...coupon,
    expiresAt: coupon.expiresAt?.toISOString(),
    createdAt: coupon.createdAt.toISOString(),
  };
}
