import { beforeEach, describe, expect, it } from 'vitest';
import { manualClock, type ManualClock } from '../src/lib/clock.js';
import { ValidationError } from '../src/lib/errors.js';
import type { Product } from '../src/models/product.js';
import { InMemoryCouponRepository } from '../src/repositories/couponRepository.js';
import { InMemoryOrderRepository } from '../src/repositories/orderRepository.js';
import { InMemoryProductRepository } from '../src/repositories/productRepository.js';
import { CouponService } from '../src/services/couponService.js';
import { OrderService } from '../src/services/orderService.js';
import { MERCHANT_A, principal } from './helpers.js';

describe('coupons', () => {
  let clock: ManualClock;
  let coupons: CouponService;
  let orders: OrderService;
  let hoodie: Product;
  let giftCard: Product;

  const order = (couponCode: string, quantity = 1) =>
    orders.createOrder(principal(), {
      customerId: 'cus_1',
      currency: 'USD',
      couponCode,
      items: [
        { productId: hoodie.id, quantity },
        { productId: giftCard.id, quantity: 1 },
      ],
    });

  beforeEach(async () => {
    clock = manualClock();
    const products = new InMemoryProductRepository(clock);
    coupons = new CouponService({ repository: new InMemoryCouponRepository(), clock });
    orders = new OrderService({ orders: new InMemoryOrderRepository(), coupons, products, clock });
    hoodie = await products.create(MERCHANT_A, {
      sku: 'HOOD-GRY-L',
      name: 'Zip Hoodie',
      priceCents: 6000,
      currency: 'USD',
      stockOnHand: 10,
    });
    giftCard = await products.create(MERCHANT_A, {
      sku: 'GIFT-25',
      name: 'Gift Card',
      priceCents: 2500,
      currency: 'USD',
      stockOnHand: 100,
    });
  });

  it('applies percent discounts to eligible lines only', async () => {
    await coupons.createCoupon(principal(), {
      code: 'fall20',
      kind: 'percent',
      value: 20,
      excludedSkus: ['gift-25'],
    });

    const placed = await order('FALL20');
    expect(placed.subtotalCents).toBe(8500);
    expect(placed.discountCents).toBe(1200);
    expect(placed.totalCents).toBe(7300);
    expect(placed.couponCode).toBe('FALL20');
  });

  it('caps fixed discounts at the eligible subtotal', async () => {
    await coupons.createCoupon(principal(), { code: 'TENOFF', kind: 'fixed', value: 1000, currency: 'USD' });
    const placed = await order('tenoff');
    expect(placed.discountCents).toBe(1000);
    expect(placed.totalCents).toBe(7500);
  });

  it('rejects expired, inactive and unknown coupons', async () => {
    await coupons.createCoupon(principal(), {
      code: 'FLASH',
      kind: 'percent',
      value: 50,
      expiresAt: new Date(clock.now().getTime() + 60_000),
    });
    clock.advance(60_000);
    await expect(order('FLASH')).rejects.toThrow(/expired/);

    await coupons.createCoupon(principal(), { code: 'OLD', kind: 'percent', value: 10 });
    await coupons.deactivate(principal(), 'old');
    await expect(order('OLD')).rejects.toBeInstanceOf(ValidationError);
    await expect(order('NOPE')).rejects.toBeInstanceOf(ValidationError);
  });

  it('enforces the minimum subtotal', async () => {
    await coupons.createCoupon(principal(), {
      code: 'BIGSPEND',
      kind: 'percent',
      value: 15,
      minSubtotalCents: 20_000,
      excludedSkus: ['GIFT-25'],
    });
    await expect(order('BIGSPEND')).rejects.toThrow(/below the minimum/);
    await expect(order('BIGSPEND', 3)).resolves.toMatchObject({ subtotalCents: 20_500, discountCents: 2700 });
  });
});
