import { type Clock, systemClock } from '../lib/clock.js';
import type { Logger } from '../lib/logger.js';
import type { WebhookDelivery } from '../models/webhook.js';
import type { WebhookRepository } from '../repositories/webhookRepository.js';
import { SIGNATURE_HEADER, signPayload } from './signing.js';

export interface DeliveryWorkerOptions {
  pollIntervalMs: number;
  batchSize: number;
  timeoutMs: number;
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface PostRequest {
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
}

export type HttpPost = (url: string, request: PostRequest) => Promise<{ status: number }>;

const fetchPost: HttpPost = async (url, request) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: request.headers,
    body: request.body,
    signal: request.signal,
    redirect: 'manual',
  });
  await response.body?.cancel();
  return { status: response.status };
};

export interface DeliveryWorkerDeps {
  repository: WebhookRepository;
  logger: Logger;
  options: DeliveryWorkerOptions;
  clock?: Clock;
  post?: HttpPost;
  random?: () => number;
}

/**
 * Polls for due deliveries and POSTs them to merchant endpoints. Failed
 * attempts are rescheduled with exponential backoff plus jitter; 4xx responses
 * other than 408/429 are treated as permanent rejections.
 */
export class DeliveryWorker {
  private readonly repository: WebhookRepository;
  private readonly logger: Logger;
  private readonly options: DeliveryWorkerOptions;
  private readonly clock: Clock;
  private readonly post: HttpPost;
  private readonly random: () => number;
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(deps: DeliveryWorkerDeps) {
    this.repository = deps.repository;
    this.logger = deps.logger;
    this.options = deps.options;
    this.clock = deps.clock ?? systemClock;
    this.post = deps.post ?? fetchPost;
    this.random = deps.random ?? Math.random;
  }

  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      void this.runOnce().catch((err: unknown) => {
        this.logger.error('webhook delivery loop failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, this.options.pollIntervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async runOnce(): Promise<number> {
    if (this.running) {
      return 0;
    }
    this.running = true;
    try {
      const due = await this.repository.listDueDeliveries(this.clock.now(), this.options.batchSize);
      for (const delivery of due) {
        await this.attempt(delivery);
      }
      return due.length;
    } finally {
      this.running = false;
    }
  }

  async attempt(delivery: WebhookDelivery): Promise<WebhookDelivery> {
    const now = this.clock.now();
    const endpoint = await this.repository.findEndpoint(delivery.merchantId, delivery.endpointId);
    if (!endpoint || !endpoint.active) {
      return this.repository.saveDelivery({
        ...delivery,
        status: 'failed',
        lastError: 'Endpoint was disabled or deleted',
        updatedAt: now,
      });
    }

    const timestamp = Math.floor(now.getTime() / 1000);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);

    let status: number | undefined;
    let error: string | undefined;
    try {
      const response = await this.post(endpoint.url, {
        headers: {
          'content-type': 'application/json',
          'user-agent': 'orders-api-webhooks/1.0',
          [SIGNATURE_HEADER]: signPayload(endpoint.secret, timestamp, delivery.payload),
          'x-orders-delivery-id': delivery.id,
          'x-orders-event-type': delivery.eventType,
        },
        body: delivery.payload,
        signal: controller.signal,
      });
      status = response.status;
    } catch (err) {
      error = controller.signal.aborted
        ? `Timed out after ${this.options.timeoutMs}ms`
        : err instanceof Error
          ? err.message
          : String(err);
    } finally {
      clearTimeout(timeout);
    }

    const attempted: WebhookDelivery = {
      ...delivery,
      attempts: delivery.attempts + 1,
      lastAttemptAt: now,
      lastResponseStatus: status,
      updatedAt: now,
    };
    const log = this.logger.child({ deliveryId: delivery.id, endpointId: endpoint.id, attempts: attempted.attempts });

    if (status !== undefined && status >= 200 && status < 300) {
      log.debug('webhook delivered', { status });
      return this.repository.saveDelivery({ ...attempted, status: 'succeeded', lastError: undefined });
    }

    if (status !== undefined && isPermanentRejection(status)) {
      log.warn('webhook rejected by endpoint', { status });
      return this.repository.saveDelivery({
        ...attempted,
        status: 'failed',
        lastError: `Endpoint responded with ${status}`,
      });
    }

    const delayMs = this.backoffMs(attempted.attempts);
    log.info('webhook delivery failed, will retry', { status, error, delayMs });
    return this.repository.saveDelivery({
      ...attempted,
      status: 'pending',
      lastError: error ?? `Endpoint responded with ${status}`,
      nextAttemptAt: new Date(now.getTime() + delayMs),
    });
  }

  private backoffMs(attempts: number): number {
    const exponential = this.options.baseDelayMs * 2 ** (attempts - 1);
    const jitter = this.random() * this.options.baseDelayMs;
    return Math.min(Math.round(exponential + jitter), this.options.maxDelayMs);
  }
}

function isPermanentRejection(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}
