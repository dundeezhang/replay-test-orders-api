import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../src/events/eventBus.js';
import { manualClock, type ManualClock } from '../src/lib/clock.js';
import { silentLogger } from '../src/lib/logger.js';
import { InMemoryOrderRepository } from '../src/repositories/orderRepository.js';
import { InMemoryProductRepository } from '../src/repositories/productRepository.js';
import { InMemoryWebhookRepository } from '../src/repositories/webhookRepository.js';
import { OrderService } from '../src/services/orderService.js';
import { DeliveryWorker, type HttpPost } from '../src/webhooks/deliveryWorker.js';
import { verifySignature } from '../src/webhooks/signing.js';
import { WebhookService } from '../src/webhooks/webhookService.js';
import { MERCHANT_A, principal } from './helpers.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('webhook delivery', () => {
  let clock: ManualClock;
  let repository: InMemoryWebhookRepository;
  let products: InMemoryProductRepository;
  let webhooks: WebhookService;
  let orderService: OrderService;
  let post: ReturnType<typeof vi.fn<HttpPost>>;
  let worker: DeliveryWorker;

  async function placeOrder() {
    const product = await products.create(MERCHANT_A, {
      sku: `TEE-${(await products.list(MERCHANT_A)).length + 1}`,
      name: 'Tee',
      priceCents: 2400,
      currency: 'USD',
      stockOnHand: 10,
    });
    const order = await orderService.createOrder(principal(), {
      customerId: 'cus_1',
      currency: 'USD',
      items: [{ productId: product.id, quantity: 1 }],
    });
    await flush();
    return order;
  }

  beforeEach(async () => {
    clock = manualClock();
    repository = new InMemoryWebhookRepository();
    const events = new EventBus(silentLogger);
    webhooks = new WebhookService({ repository, events, logger: silentLogger, clock });
    webhooks.subscribeToDomainEvents();
    products = new InMemoryProductRepository(clock);
    orderService = new OrderService({ orders: new InMemoryOrderRepository(), products, events, clock });
    post = vi.fn<HttpPost>(async () => ({ status: 200 }));
    worker = new DeliveryWorker({
      repository,
      logger: silentLogger,
      clock,
      post,
      random: () => 0,
      options: {
        pollIntervalMs: 1000,
        batchSize: 10,
        timeoutMs: 1000,
        maxAttempts: 3,
        baseDelayMs: 30_000,
        maxDelayMs: 3_600_000,
      },
    });
  });

  it('delivers signed order events to subscribed endpoints only', async () => {
    const subscribed = await webhooks.createEndpoint(principal(), {
      url: 'https://hooks.example.com/orders',
      events: ['order.created'],
    });
    await webhooks.createEndpoint(principal(), { url: 'https://hooks.example.com/paid', events: ['order.paid'] });

    const order = await placeOrder();
    expect(await worker.runOnce()).toBe(1);

    const [url, request] = post.mock.calls[0]!;
    expect(url).toBe(subscribed.url);
    expect(JSON.parse(request.body)).toMatchObject({ type: 'order.created', data: { order: { id: order.id } } });
    const nowSeconds = Math.floor(clock.now().getTime() / 1000);
    expect(verifySignature(subscribed.secret, request.headers['x-orders-signature']!, request.body, nowSeconds)).toBe(
      true,
    );

    const [delivery] = await webhooks.listDeliveries(subscribed.id);
    expect(delivery).toMatchObject({ status: 'succeeded', attempts: 1, lastResponseStatus: 200 });
  });

  it('reschedules failed attempts with exponential backoff', async () => {
    const endpoint = await webhooks.createEndpoint(principal(), {
      url: 'https://hooks.example.com/orders',
      events: ['order.created'],
    });
    post.mockResolvedValue({ status: 503 });
    await placeOrder();

    await worker.runOnce();
    let [delivery] = await webhooks.listDeliveries(endpoint.id);
    expect(delivery).toMatchObject({ status: 'pending', attempts: 1, lastError: 'Endpoint responded with 503' });
    expect(delivery!.nextAttemptAt.getTime() - clock.now().getTime()).toBe(30_000);

    expect(await worker.runOnce()).toBe(0);
    clock.advance(30_000);
    await worker.runOnce();
    [delivery] = await webhooks.listDeliveries(endpoint.id);
    expect(delivery!.attempts).toBe(2);
    expect(delivery!.nextAttemptAt.getTime() - clock.now().getTime()).toBe(60_000);
  });

  it('fails immediately on permanent 4xx rejections', async () => {
    const endpoint = await webhooks.createEndpoint(principal(), {
      url: 'https://hooks.example.com/orders',
      events: ['order.created'],
    });
    post.mockResolvedValue({ status: 410 });
    await placeOrder();

    await worker.runOnce();
    const [delivery] = await webhooks.listDeliveries(endpoint.id);
    expect(delivery).toMatchObject({ status: 'failed', attempts: 1 });
  });

  it('treats network errors as retryable', async () => {
    const endpoint = await webhooks.createEndpoint(principal(), {
      url: 'https://hooks.example.com/orders',
      events: ['order.created'],
    });
    post.mockRejectedValue(new Error('ECONNREFUSED'));
    await placeOrder();

    await worker.runOnce();
    const [delivery] = await webhooks.listDeliveries(endpoint.id);
    expect(delivery).toMatchObject({ status: 'pending', lastError: 'ECONNREFUSED' });
  });

  it('fails deliveries for endpoints that were disabled', async () => {
    const endpoint = await webhooks.createEndpoint(principal(), {
      url: 'https://hooks.example.com/orders',
      events: ['order.created'],
    });
    await placeOrder();
    await webhooks.updateEndpoint(principal(), endpoint.id, { active: false });

    await worker.runOnce();
    expect(post).not.toHaveBeenCalled();
    const [delivery] = await webhooks.listDeliveries(endpoint.id);
    expect(delivery!.status).toBe('failed');
  });
});
