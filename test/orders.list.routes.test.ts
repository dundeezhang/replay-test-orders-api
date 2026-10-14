import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Product } from '../src/models/product.js';
import { bearer, buildTestContext, MERCHANT_A, principal, TEST_KEYS } from './helpers.js';

describe('GET /v1/orders', () => {
  let ctx: ReturnType<typeof buildTestContext>;
  let tee: Product;

  async function createOrder(customerId: string, quantity: number) {
    const order = await ctx.orderService.createOrder(principal(), {
      customerId,
      currency: 'USD',
      items: [{ productId: tee.id, quantity }],
    });
    ctx.clock.advance(60_000);
    return order;
  }

  beforeEach(async () => {
    ctx = buildTestContext();
    tee = await ctx.products.create(MERCHANT_A, {
      sku: 'TEE-BLK-M',
      name: 'Classic Tee',
      priceCents: 2400,
      currency: 'USD',
      stockOnHand: 100,
    });
  });

  it('returns newest orders first with page info', async () => {
    const first = await createOrder('cus_1', 1);
    const second = await createOrder('cus_2', 1);

    const res = await request(ctx.app).get('/v1/orders').set(bearer(TEST_KEYS.staffA));

    expect(res.status).toBe(200);
    expect(res.body.data.map((order: { id: string }) => order.id)).toEqual([second.id, first.id]);
    expect(res.body.pageInfo).toMatchObject({ page: 1, totalItems: 2 });
  });

  it('pages through results', async () => {
    for (let i = 0; i < 4; i += 1) {
      await createOrder(`cus_${i}`, i + 1);
    }

    const res = await request(ctx.app)
      .get('/v1/orders')
      .query({ page: 2, pageSize: 2, sort: 'totalCents' })
      .set(bearer(TEST_KEYS.staffA));

    expect(res.status).toBe(200);
    expect(res.body.data.map((order: { totalCents: number }) => order.totalCents)).toEqual([7200, 9600]);
    expect(res.body.pageInfo).toMatchObject({ totalPages: 2, hasNextPage: false, hasPreviousPage: true });
  });

  it('filters by status and customer', async () => {
    const paid = await createOrder('cus_1', 1);
    await createOrder('cus_1', 2);
    await createOrder('cus_2', 3);
    await ctx.orderService.markPaid(principal(), paid.id);

    const res = await request(ctx.app)
      .get('/v1/orders')
      .query({ status: 'paid', customerId: 'cus_1' })
      .set(bearer(TEST_KEYS.staffA));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(paid.id);
  });

  it('filters by creation date', async () => {
    await createOrder('cus_1', 1);

    const inRange = await request(ctx.app)
      .get('/v1/orders')
      .query({ createdFrom: '2023-12-31', createdTo: '2024-01-02' })
      .set(bearer(TEST_KEYS.staffA));
    expect(inRange.body.data).toHaveLength(1);

    const outOfRange = await request(ctx.app)
      .get('/v1/orders')
      .query({ createdFrom: '2024-02-01' })
      .set(bearer(TEST_KEYS.staffA));
    expect(outOfRange.body.data).toHaveLength(0);
  });

  it('rejects invalid query parameters', async () => {
    const res = await request(ctx.app)
      .get('/v1/orders')
      .query({ page: 0 })
      .set(bearer(TEST_KEYS.staffA));
    expect(res.status).toBe(400);
  });
});
