import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Product } from '../src/models/product.js';
import { bearer, buildTestContext, MERCHANT_A, TEST_KEYS } from './helpers.js';

describe('Idempotency-Key on POST /v1/orders', () => {
  let ctx: ReturnType<typeof buildTestContext>;
  let tee: Product;

  const create = (key: string, quantity = 1) =>
    request(ctx.app)
      .post('/v1/orders')
      .set({ ...bearer(TEST_KEYS.staffA), 'idempotency-key': key })
      .send({ customerId: 'cus_1', currency: 'USD', items: [{ productId: tee.id, quantity }] });

  beforeEach(async () => {
    ctx = buildTestContext();
    tee = await ctx.products.create(MERCHANT_A, {
      sku: 'TEE-BLK-M',
      name: 'Classic Tee',
      priceCents: 2400,
      currency: 'USD',
      stockOnHand: 10,
    });
  });

  it('replays the original response for a retried request', async () => {
    const first = await create('retry-key-0001');
    const second = await create('retry-key-0001');

    expect(second.status).toBe(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(await ctx.orders.list(MERCHANT_A)).toHaveLength(1);
  });

  it('rejects reuse of a key with a different body', async () => {
    await create('retry-key-0002', 1);
    const res = await create('retry-key-0002', 2);
    expect(res.status).toBe(409);
  });

  it('rejects malformed keys', async () => {
    const res = await create('short');
    expect(res.status).toBe(400);
  });
});
