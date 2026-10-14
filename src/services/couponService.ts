import { type Clock, systemClock } from '../lib/clock.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { type Currency, sumCents } from '../lib/money.js';
import type { AppliedCoupon, Coupon, CouponKind, CouponRestrictions } from '../models/coupon.js';
import type { OrderItem } from '../models/order.js';
import type { Principal } from '../models/principal.js';
import type { CouponRepository } from '../repositories/couponRepository.js';

export interface CreateCouponInput {
  code: string;
  kind: CouponKind;
  value: number;
  currency?: Currency;
  maxRedemptions?: number;
  expiresAt?: Date;
  minSubtotalCents?: number;
  excludedSkus?: string[];
}

const DEFAULT_RESTRICTIONS: CouponRestrictions = {
  minSubtotalCents: 0,
  excludedSkus: [],
};

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

export function calculateDiscountCents(coupon: Coupon, eligibleSubtotalCents: number): number {
  if (coupon.kind === 'fixed') {
    return Math.min(coupon.value, eligibleSubtotalCents);
  }
  const eligibleSubtotal = eligibleSubtotalCents / 100;
  const discount = eligibleSubtotal * (coupon.value / 100);
  return Math.floor(discount * 100);
}

export class CouponService {
  private readonly repository: CouponRepository;
  private readonly clock: Clock;

  constructor(deps: { repository: CouponRepository; clock?: Clock }) {
    this.repository = deps.repository;
    this.clock = deps.clock ?? systemClock;
  }

  async createCoupon(principal: Principal, input: CreateCouponInput): Promise<Coupon> {
    if (input.kind === 'percent' && (input.value <= 0 || input.value > 100)) {
      throw new ValidationError('Percent coupons must take between 1 and 100 percent off');
    }
    if (input.kind === 'fixed' && (!Number.isInteger(input.value) || !input.currency)) {
      throw new ValidationError('Fixed coupons need a whole number of cents and a currency');
    }

    const restrictions = { ...DEFAULT_RESTRICTIONS };
    if (input.minSubtotalCents !== undefined) {
      restrictions.minSubtotalCents = input.minSubtotalCents;
    }
    for (const sku of input.excludedSkus ?? []) {
      restrictions.excludedSkus.push(sku.toUpperCase());
    }

    return this.repository.create({
      id: newId('cpn'),
      merchantId: principal.merchantId,
      code: normalizeCode(input.code),
      kind: input.kind,
      value: input.value,
      currency: input.currency,
      restrictions,
      maxRedemptions: input.maxRedemptions,
      timesRedeemed: 0,
      expiresAt: input.expiresAt,
      active: true,
      createdAt: this.clock.now(),
    });
  }

  async getCoupon(principal: Principal, code: string): Promise<Coupon> {
    const coupon = await this.repository.findByCode(principal.merchantId, normalizeCode(code));
    if (!coupon) {
      throw new NotFoundError('Coupon', code);
    }
    return coupon;
  }

  async deactivate(principal: Principal, code: string): Promise<Coupon> {
    const coupon = await this.getCoupon(principal, code);
    return this.repository.save({ ...coupon, active: false });
  }

  /** Validates a coupon against the order lines and records the redemption. */
  async redeem(
    merchantId: string,
    rawCode: string,
    currency: Currency,
    items: readonly OrderItem[],
  ): Promise<AppliedCoupon> {
    const coupon = await this.repository.findByCode(merchantId, normalizeCode(rawCode));
    if (!coupon || !coupon.active) {
      throw new ValidationError(`Coupon ${rawCode} is not valid`);
    }
    if (coupon.expiresAt && coupon.expiresAt <= this.clock.now()) {
      throw new ValidationError(`Coupon ${coupon.code} has expired`);
    }
    if (coupon.kind === 'fixed' && coupon.currency !== currency) {
      throw new ValidationError(`Coupon ${coupon.code} can only be used for ${coupon.currency} orders`);
    }

    const subtotalCents = sumCents(items.map((item) => item.lineTotalCents));
    if (subtotalCents < coupon.restrictions.minSubtotalCents) {
      throw new ValidationError(`Order subtotal is below the minimum for coupon ${coupon.code}`);
    }

    const eligibleCents = sumCents(
      items
        .filter((item) => !coupon.restrictions.excludedSkus.includes(item.sku))
        .map((item) => item.lineTotalCents),
    );
    const discountCents = calculateDiscountCents(coupon, eligibleCents);

    await this.repository.recordRedemption(merchantId, coupon.code);
    return { code: coupon.code, discountCents };
  }
}
