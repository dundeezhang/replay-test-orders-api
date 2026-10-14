import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { manualClock } from '../src/lib/clock.js';
import { silentLogger } from '../src/lib/logger.js';
import type { Product } from '../src/models/product.js';
import { FakePaymentGateway } from '../src/payments/fakePaymentGateway.js';
import { InMemoryOrderRepository } from '../src/repositories/orderRepository.js';
import { InMemoryProductRepository } from '../src/repositories/productRepository.js';
import { InMemoryReservationRepository } from '../src/repositories/reservationRepository.js';
import { createApp } from '../src/server.js';
import { CheckoutService } from '../src/services/checkoutService.js';
import { InventoryService } from '../src/services/inventoryService.js';
import { OrderService } from '../src/services/orderService.js';
import { bearer, MERCHANT_A, TEST_API_KEYS, TEST_KEYS } from './helpers.js';

function buildCheckoutApp() {
  const clock = manualClock();
  const products = new InMemoryProductRepository(clock);
  const orderService = new OrderService({ orders: new InMemoryOrderRepository(), products, clock });
  const inventory = new InventoryService({
    products,
    reservations: new InMemoryReservationRepository(),
    logger: silentLogger,
    reservationTtlMs: 15 * 60 * 1000,
    clock,
  });
  const payments = new FakePaymentGateway();
  const checkout = new CheckoutService({ orders: orderService, inventory, payments, logger: silentLogger });
  const app = createApp({
    logger: silentLogger,
    apiKeys: TEST_API_KEYS,
    products,
    orderService,
    checkout,
    inventory,
  });
  return { app, products, payments, clock };
}

describe('checkout routes', () => {
  let ctx: ReturnType<typeof buildCheckoutApp>;
  let mug: Product;

  async function createOrder(quantity: number): Promise<string> {
    const res = await request(ctx.app)
      .post('/v1/orders')
      .set(bearer(TEST_KEYS.staffA))
      .send({ customerId: 'cus_1', currency: 'USD', items: [{ productId: mug.id, quantity }] });
    expect(res.status).toBe(201);
    return res.body.data.id as string;
  }

  function checkout(orderId: string, paymentMethodToken = 'pm_card_visa') {
    return request(ctx.app)
      .post(`/v1/orders/${orderId}/checkout`)
      .set(bearer(TEST_KEYS.staffA))
      .send({ paymentMethodToken });
  }

  function availability() {
    return request(ctx.app).get(`/v1/inventory/${mug.id}`).set(bearer(TEST_KEYS.staffA));
  }

  beforeEach(async () => {
    ctx = buildCheckoutApp();
    mug = await ctx.products.create(MERCHANT_A, {
      sku: 'MUG-12OZ',
      name: 'Enamel Mug',
      priceCents: 1800,
      currency: 'USD',
      stockOnHand: 3,
    });
  });

  it('charges the order total, commits stock and marks the order paid', async () => {
    const orderId = await createOrder(2);
    const res = await checkout(orderId);

    expect(res.status).toBe(200);
    expect(res.body.data.order.status).toBe('paid');
    expect(res.body.data.reservation.status).toBe('committed');
    expect(res.body.data.chargeId).toMatch(/^ch_/);
    expect(ctx.payments.requests[0]).toMatchObject({ amountCents: 3600, currency: 'USD' });

    const stock = await availability();
    expect(stock.body.data).toMatchObject({ stockOnHand: 1, reserved: 0, available: 1 });
  });

  it('releases the reservation when the card is declined', async () => {
    const orderId = await createOrder(3);
    const res = await checkout(orderId, 'pm_card_declined');

    expect(res.status).toBe(402);
    expect(res.body.error).toMatchObject({ code: 'payment_declined', details: { declineCode: 'card_declined' } });
    expect((await availability()).body.data.available).toBe(3);
  });

  it('releases the reservation when the gateway is unavailable', async () => {
    const orderId = await createOrder(1);
    const res = await checkout(orderId, 'pm_gateway_timeout');

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('payment_unavailable');
    expect((await availability()).body.data.available).toBe(3);
  });

  it('returns shortages once stock has been sold through', async () => {
    const first = await createOrder(2);
    const second = await createOrder(2);
    await ctx.products.update(MERCHANT_A, mug.id, { stockOnHand: 2 });

    expect((await checkout(first)).status).toBe(200);
    const res = await checkout(second);
    expect(res.status).toBe(409);
    expect(res.body.error.details.shortages).toEqual([{ sku: 'MUG-12OZ', requested: 2, available: 0 }]);
  });

  it('rejects checkout for orders that are not pending', async () => {
    const orderId = await createOrder(1);
    expect((await checkout(orderId)).status).toBe(200);

    const again = await checkout(orderId);
    expect(again.status).toBe(409);
  });

  it('validates the payment method token', async () => {
    const orderId = await createOrder(1);
    const res = await checkout(orderId, '');
    expect(res.status).toBe(400);
  });

  it('does not expose another merchant’s reservations', async () => {
    const orderId = await createOrder(1);
    const res = await checkout(orderId);

    const lookup = await request(ctx.app)
      .get(`/v1/reservations/${res.body.data.reservation.id}`)
      .set(bearer(TEST_KEYS.adminB));
    expect(lookup.status).toBe(404);
  });
});
