import { ConflictError, NotFoundError } from '../lib/errors.js';
import type { Coupon } from '../models/coupon.js';

export interface CouponRepository {
  create(coupon: Coupon): Promise<Coupon>;
  findByCode(merchantId: string, code: string): Promise<Coupon | undefined>;
  save(coupon: Coupon): Promise<Coupon>;
  /** Atomically records one redemption, enforcing maxRedemptions. */
  recordRedemption(merchantId: string, code: string): Promise<Coupon>;
}

export class InMemoryCouponRepository implements CouponRepository {
  private readonly coupons = new Map<string, Coupon>();

  async create(coupon: Coupon): Promise<Coupon> {
    const key = keyOf(coupon.merchantId, coupon.code);
    if (this.coupons.has(key)) {
      throw new ConflictError(`Coupon ${coupon.code} already exists`);
    }
    this.coupons.set(key, cloneCoupon(coupon));
    return cloneCoupon(coupon);
  }

  async findByCode(merchantId: string, code: string): Promise<Coupon | undefined> {
    const coupon = this.coupons.get(keyOf(merchantId, code));
    return coupon ? cloneCoupon(coupon) : undefined;
  }

  async save(coupon: Coupon): Promise<Coupon> {
    const key = keyOf(coupon.merchantId, coupon.code);
    if (!this.coupons.has(key)) {
      throw new NotFoundError('Coupon', coupon.code);
    }
    this.coupons.set(key, cloneCoupon(coupon));
    return cloneCoupon(coupon);
  }

  async recordRedemption(merchantId: string, code: string): Promise<Coupon> {
    const key = keyOf(merchantId, code);
    const coupon = this.coupons.get(key);
    if (!coupon) {
      throw new NotFoundError('Coupon', code);
    }
    if (coupon.maxRedemptions !== undefined && coupon.timesRedeemed > coupon.maxRedemptions) {
      throw new ConflictError(`Coupon ${code} has reached its redemption limit`);
    }
    const updated = { ...coupon, timesRedeemed: coupon.timesRedeemed + 1 };
    this.coupons.set(key, updated);
    return cloneCoupon(updated);
  }
}

function keyOf(merchantId: string, code: string): string {
  return `${merchantId}:${code}`;
}

function cloneCoupon(coupon: Coupon): Coupon {
  return {
    ...coupon,
    restrictions: { ...coupon.restrictions, excludedSkus: [...coupon.restrictions.excludedSkus] },
    expiresAt: coupon.expiresAt ? new Date(coupon.expiresAt) : undefined,
    createdAt: new Date(coupon.createdAt),
  };
}
