import {
  DOMAIN_EVENT_TYPES,
  type DomainEvents,
  type DomainEventType,
  type EventBus,
  type EventMeta,
} from '../events/eventBus.js';
import { type Clock, systemClock } from '../lib/clock.js';
import { ConflictError, NotFoundError } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import type { Logger } from '../lib/logger.js';
import type { Principal } from '../models/principal.js';
import type { WebhookDelivery, WebhookEndpoint } from '../models/webhook.js';
import type { WebhookRepository } from '../repositories/webhookRepository.js';
import { generateSigningSecret } from './signing.js';

export interface CreateEndpointInput {
  url: string;
  description?: string;
  events: DomainEventType[];
}

export type UpdateEndpointInput = Partial<CreateEndpointInput & { active: boolean }>;

export interface WebhookServiceDeps {
  repository: WebhookRepository;
  events: EventBus;
  logger: Logger;
  clock?: Clock;
}

export class WebhookService {
  private readonly repository: WebhookRepository;
  private readonly events: EventBus;
  private readonly logger: Logger;
  private readonly clock: Clock;

  constructor(deps: WebhookServiceDeps) {
    this.repository = deps.repository;
    this.events = deps.events;
    this.logger = deps.logger;
    this.clock = deps.clock ?? systemClock;
  }

  /** Fan every domain event out to the merchant's subscribed endpoints. */
  subscribeToDomainEvents(): void {
    for (const type of DOMAIN_EVENT_TYPES) {
      this.events.on(type, (payload, meta) => this.enqueue(meta, payload));
    }
  }

  async createEndpoint(principal: Principal, input: CreateEndpointInput): Promise<WebhookEndpoint> {
    const now = this.clock.now();
    const endpoint = await this.repository.createEndpoint({
      id: newId('whe'),
      merchantId: principal.merchantId,
      url: input.url,
      description: input.description,
      secret: generateSigningSecret(),
      events: [...new Set(input.events)],
      active: true,
      createdAt: now,
      updatedAt: now,
    });
    this.logger.info('webhook endpoint created', { endpointId: endpoint.id, merchantId: endpoint.merchantId });
    return endpoint;
  }

  async listEndpoints(principal: Principal): Promise<WebhookEndpoint[]> {
    return this.repository.listEndpoints(principal.merchantId);
  }

  async getEndpoint(principal: Principal, id: string): Promise<WebhookEndpoint> {
    const endpoint = await this.repository.findEndpoint(principal.merchantId, id);
    if (!endpoint) {
      throw new NotFoundError('Webhook endpoint', id);
    }
    return endpoint;
  }

  async updateEndpoint(principal: Principal, id: string, patch: UpdateEndpointInput): Promise<WebhookEndpoint> {
    const endpoint = await this.getEndpoint(principal, id);
    return this.repository.saveEndpoint({
      ...endpoint,
      ...patch,
      events: patch.events ? [...new Set(patch.events)] : endpoint.events,
      updatedAt: this.clock.now(),
    });
  }

  async deleteEndpoint(principal: Principal, id: string): Promise<void> {
    const deleted = await this.repository.deleteEndpoint(principal.merchantId, id);
    if (!deleted) {
      throw new NotFoundError('Webhook endpoint', id);
    }
  }

  async listDeliveries(endpointId: string, limit = 50): Promise<WebhookDelivery[]> {
    return this.repository.listDeliveries(endpointId, limit);
  }

  /** Re-queues a failed delivery for immediate redelivery. */
  async retryDelivery(principal: Principal, endpointId: string, deliveryId: string): Promise<WebhookDelivery> {
    const delivery = await this.repository.findDelivery(principal.merchantId, deliveryId);
    if (!delivery || delivery.endpointId !== endpointId) {
      throw new NotFoundError('Webhook delivery', deliveryId);
    }
    if (delivery.status !== 'failed') {
      throw new ConflictError(`Delivery ${deliveryId} is ${delivery.status}; only failed deliveries can be retried`);
    }
    const now = this.clock.now();
    return this.repository.saveDelivery({ ...delivery, status: 'pending', nextAttemptAt: now, updatedAt: now });
  }

  private async enqueue<T extends DomainEventType>(meta: EventMeta, payload: DomainEvents[T]): Promise<void> {
    const endpoints = await this.repository.listSubscribedEndpoints(meta.merchantId, meta.type);
    if (endpoints.length === 0) {
      return;
    }

    const body = JSON.stringify({
      id: meta.id,
      type: meta.type,
      createdAt: meta.occurredAt.toISOString(),
      data: payload,
    });
    const now = this.clock.now();
    for (const endpoint of endpoints) {
      await this.repository.createDelivery({
        id: newId('whd'),
        endpointId: endpoint.id,
        merchantId: meta.merchantId,
        eventId: meta.id,
        eventType: meta.type,
        payload: body,
        status: 'pending',
        attempts: 0,
        nextAttemptAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }
    this.logger.debug('webhook deliveries queued', { eventId: meta.id, count: endpoints.length });
  }
}
