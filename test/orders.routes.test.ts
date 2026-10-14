import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Product } from '../src/models/product.js';
import { bearer, buildTestContext, MERCHANT_A, TEST_KEYS } from './helpers.js';

describe('orders routes', () => {
  let ctx: ReturnType<typeof buildTestContext>;
  let tee: Product;

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

  it('requires an API key', async () => {
    const res = await request(ctx.app).get('/v1/orders');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
  });

  it('creates and fetches an order', async () => {
    const created = await request(ctx.app)
      .post('/v1/orders')
      .set(bearer(TEST_KEYS.staffA))
      .send({ customerId: 'cus_1', currency: 'USD', items: [{ productId: tee.id, quantity: 2 }] });

    expect(created.status).toBe(201);
    expect(created.body.data.totalCents).toBe(4800);

    const fetched = await request(ctx.app)
      .get(`/v1/orders/${created.body.data.id}`)
      .set(bearer(TEST_KEYS.staffA));
    expect(fetched.status).toBe(200);
    expect(fetched.body.data.id).toBe(created.body.data.id);
  });

  it('returns 400 with details for invalid payloads', async () => {
    const res = await request(ctx.app)
      .post('/v1/orders')
      .set(bearer(TEST_KEYS.staffA))
      .send({ customerId: '', currency: 'JPY', items: [] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('only lets admins mark orders as paid', async () => {
    const created = await request(ctx.app)
      .post('/v1/orders')
      .set(bearer(TEST_KEYS.staffA))
      .send({ customerId: 'cus_1', currency: 'USD', items: [{ productId: tee.id, quantity: 1 }] });

    const asStaff = await request(ctx.app)
      .post(`/v1/orders/${created.body.data.id}/pay`)
      .set(bearer(TEST_KEYS.staffA));
    expect(asStaff.status).toBe(403);

    const asAdmin = await request(ctx.app)
      .post(`/v1/orders/${created.body.data.id}/pay`)
      .set(bearer(TEST_KEYS.adminA));
    expect(asAdmin.status).toBe(200);
    expect(asAdmin.body.data.status).toBe('paid');
  });

  it('hides orders from other merchants', async () => {
    const created = await request(ctx.app)
      .post('/v1/orders')
      .set(bearer(TEST_KEYS.adminA))
      .send({ customerId: 'cus_1', currency: 'USD', items: [{ productId: tee.id, quantity: 1 }] });

    const res = await request(ctx.app)
      .get(`/v1/orders/${created.body.data.id}`)
      .set(bearer(TEST_KEYS.adminB));
    expect(res.status).toBe(404);
  });
});
