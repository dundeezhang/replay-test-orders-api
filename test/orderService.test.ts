import { beforeEach, describe, expect, it } from 'vitest';
import { ConflictError, NotFoundError, ValidationError } from '../src/lib/errors.js';
import type { Product } from '../src/models/product.js';
import { buildTestContext, MERCHANT_A, MERCHANT_B, principal } from './helpers.js';

describe('OrderService', () => {
  let ctx: ReturnType<typeof buildTestContext>;
  let tee: Product;
  let mug: Product;

  beforeEach(async () => {
    ctx = buildTestContext();
    tee = await ctx.products.create(MERCHANT_A, {
      sku: 'tee-blk-m',
      name: 'Classic Tee',
      priceCents: 2400,
      currency: 'USD',
      stockOnHand: 10,
    });
    mug = await ctx.products.create(MERCHANT_A, {
      sku: 'MUG-12OZ',
      name: 'Enamel Mug',
      priceCents: 1850,
      currency: 'USD',
      stockOnHand: 5,
    });
  });

  it('prices orders from the catalog and merges duplicate lines', async () => {
    const order = await ctx.orderService.createOrder(principal(), {
      customerId: 'cus_123',
      currency: 'USD',
      items: [
        { productId: tee.id, quantity: 1 },
        { productId: mug.id, quantity: 2 },
        { productId: tee.id, quantity: 1 },
      ],
    });

    expect(order.status).toBe('pending');
    expect(order.items).toHaveLength(2);
    expect(order.items.find((item) => item.productId === tee.id)?.quantity).toBe(2);
    expect(order.subtotalCents).toBe(2 * 2400 + 2 * 1850);
    expect(order.totalCents).toBe(order.subtotalCents);
  });

  it('rejects products from another merchant', async () => {
    await expect(
      ctx.orderService.createOrder(principal(MERCHANT_B), {
        customerId: 'cus_123',
        currency: 'USD',
        items: [{ productId: tee.id, quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects inactive products and currency mismatches', async () => {
    await ctx.products.update(MERCHANT_A, mug.id, { active: false });
    await expect(
      ctx.orderService.createOrder(principal(), {
        customerId: 'cus_123',
        currency: 'USD',
        items: [{ productId: mug.id, quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      ctx.orderService.createOrder(principal(), {
        customerId: 'cus_123',
        currency: 'EUR',
        items: [{ productId: tee.id, quantity: 1 }],
      }),
    ).rejects.toThrow(/priced in USD/);
  });

  it('enforces the order state machine', async () => {
    const order = await ctx.orderService.createOrder(principal(), {
      customerId: 'cus_123',
      currency: 'USD',
      items: [{ productId: tee.id, quantity: 1 }],
    });

    const paid = await ctx.orderService.markPaid(principal(), order.id);
    expect(paid.status).toBe('paid');
    expect(paid.paidAt).toBeInstanceOf(Date);

    const cancelled = await ctx.orderService.cancelOrder(principal(), order.id);
    expect(cancelled.status).toBe('cancelled');

    await expect(ctx.orderService.markPaid(principal(), order.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it('does not expose orders across merchants', async () => {
    const order = await ctx.orderService.createOrder(principal(), {
      customerId: 'cus_123',
      currency: 'USD',
      items: [{ productId: tee.id, quantity: 1 }],
    });

    await expect(ctx.orderService.getOrder(principal(MERCHANT_B), order.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
