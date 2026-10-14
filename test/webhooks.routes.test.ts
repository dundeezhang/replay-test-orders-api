import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { EventBus } from '../src/events/eventBus.js';
import { silentLogger } from '../src/lib/logger.js';
import { InMemoryOrderRepository } from '../src/repositories/orderRepository.js';
import { InMemoryProductRepository } from '../src/repositories/productRepository.js';
import { InMemoryWebhookRepository } from '../src/repositories/webhookRepository.js';
import { createApp } from '../src/server.js';
import { OrderService } from '../src/services/orderService.js';
import { WebhookService } from '../src/webhooks/webhookService.js';
import { bearer, TEST_API_KEYS, TEST_KEYS } from './helpers.js';

function buildApp() {
  const products = new InMemoryProductRepository();
  const events = new EventBus(silentLogger);
  const orderService = new OrderService({ orders: new InMemoryOrderRepository(), products, events });
  const webhooks = new WebhookService({ repository: new InMemoryWebhookRepository(), events, logger: silentLogger });
  return createApp({ logger: silentLogger, apiKeys: TEST_API_KEYS, products, orderService, webhooks });
}

describe('webhook routes', () => {
  let app: ReturnType<typeof buildApp>;

  const register = (key: string = TEST_KEYS.adminA) =>
    request(app)
      .post('/v1/webhooks')
      .set(bearer(key))
      .send({ url: 'https://hooks.example.com/orders', events: ['order.paid', 'order.paid'] });

  beforeEach(() => {
    app = buildApp();
  });

  it('returns the signing secret only when the endpoint is created', async () => {
    const created = await register();
    expect(created.status).toBe(201);
    expect(created.body.data.secret).toMatch(/^ordwh_/);
    expect(created.body.data.events).toEqual(['order.paid']);

    const listed = await request(app).get('/v1/webhooks').set(bearer(TEST_KEYS.adminA));
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0].secret).toBeUndefined();
  });

  it('requires an admin key', async () => {
    const res = await register(TEST_KEYS.staffA);
    expect(res.status).toBe(403);
  });

  it('validates the url and event types', async () => {
    const res = await request(app)
      .post('/v1/webhooks')
      .set(bearer(TEST_KEYS.adminA))
      .send({ url: 'not a url', events: ['order.shipped'] });
    expect(res.status).toBe(400);
  });

  it('updates and deletes endpoints', async () => {
    const { body } = await register();
    const id = body.data.id as string;

    const patched = await request(app)
      .patch(`/v1/webhooks/${id}`)
      .set(bearer(TEST_KEYS.adminA))
      .send({ active: false });
    expect(patched.status).toBe(200);
    expect(patched.body.data.active).toBe(false);

    expect((await request(app).delete(`/v1/webhooks/${id}`).set(bearer(TEST_KEYS.adminA))).status).toBe(204);
    expect((await request(app).get(`/v1/webhooks/${id}`).set(bearer(TEST_KEYS.adminA))).status).toBe(404);
  });

  it('hides endpoints from other merchants', async () => {
    const { body } = await register();
    const res = await request(app).get(`/v1/webhooks/${body.data.id}`).set(bearer(TEST_KEYS.adminB));
    expect(res.status).toBe(404);
  });
});
