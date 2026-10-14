import type { Currency } from '../lib/money.js';

export type CouponKind = 'percent' | 'fixed';

export interface CouponRestrictions {
  minSubtotalCents: number;
  /** SKUs whose line totals do not count towards the discount. */
  excludedSkus: string[];
}

export interface Coupon {
  id: string;
  merchantId: string;
  /** Upper-cased; lookups are case-insensitive. */
  code: string;
  kind: CouponKind;
  /** Percent off (1-100) for percent coupons, cents off for fixed coupons. */
  value: number;
  /** Required for fixed-amount coupons. */
  currency?: Currency;
  restrictions: CouponRestrictions;
  maxRedemptions?: number;
  timesRedeemed: number;
  expiresAt?: Date;
  active: boolean;
  createdAt: Date;
}

export interface AppliedCoupon {
  code: string;
  discountCents: number;
}
