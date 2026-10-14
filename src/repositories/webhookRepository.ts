import type { DomainEventType } from '../events/eventBus.js';
import { ConflictError, NotFoundError } from '../lib/errors.js';
import type { WebhookDelivery, WebhookEndpoint } from '../models/webhook.js';

export interface WebhookRepository {
  createEndpoint(endpoint: WebhookEndpoint): Promise<WebhookEndpoint>;
  findEndpoint(merchantId: string, id: string): Promise<WebhookEndpoint | undefined>;
  listEndpoints(merchantId: string): Promise<WebhookEndpoint[]>;
  listSubscribedEndpoints(merchantId: string, eventType: DomainEventType): Promise<WebhookEndpoint[]>;
  saveEndpoint(endpoint: WebhookEndpoint): Promise<WebhookEndpoint>;
  deleteEndpoint(merchantId: string, id: string): Promise<boolean>;

  createDelivery(delivery: WebhookDelivery): Promise<WebhookDelivery>;
  findDelivery(merchantId: string, id: string): Promise<WebhookDelivery | undefined>;
  listDeliveries(endpointId: string, limit: number): Promise<WebhookDelivery[]>;
  /** Pending deliveries whose next attempt is due, oldest first. */
  listDueDeliveries(now: Date, limit: number): Promise<WebhookDelivery[]>;
  saveDelivery(delivery: WebhookDelivery): Promise<WebhookDelivery>;
}

export class InMemoryWebhookRepository implements WebhookRepository {
  private readonly endpoints = new Map<string, WebhookEndpoint>();
  private readonly deliveries = new Map<string, WebhookDelivery>();

  async createEndpoint(endpoint: WebhookEndpoint): Promise<WebhookEndpoint> {
    if (this.endpoints.has(endpoint.id)) {
      throw new ConflictError(`Webhook endpoint ${endpoint.id} already exists`);
    }
    this.endpoints.set(endpoint.id, cloneEndpoint(endpoint));
    return cloneEndpoint(endpoint);
  }

  async findEndpoint(merchantId: string, id: string): Promise<WebhookEndpoint | undefined> {
    const endpoint = this.endpoints.get(id);
    return endpoint && endpoint.merchantId === merchantId ? cloneEndpoint(endpoint) : undefined;
  }

  async listEndpoints(merchantId: string): Promise<WebhookEndpoint[]> {
    return [...this.endpoints.values()]
      .filter((endpoint) => endpoint.merchantId === merchantId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map(cloneEndpoint);
  }

  async listSubscribedEndpoints(merchantId: string, eventType: DomainEventType): Promise<WebhookEndpoint[]> {
    return (await this.listEndpoints(merchantId)).filter(
      (endpoint) => endpoint.active && endpoint.events.includes(eventType),
    );
  }

  async saveEndpoint(endpoint: WebhookEndpoint): Promise<WebhookEndpoint> {
    const existing = this.endpoints.get(endpoint.id);
    if (!existing || existing.merchantId !== endpoint.merchantId) {
      throw new NotFoundError('Webhook endpoint', endpoint.id);
    }
    this.endpoints.set(endpoint.id, cloneEndpoint(endpoint));
    return cloneEndpoint(endpoint);
  }

  async deleteEndpoint(merchantId: string, id: string): Promise<boolean> {
    const existing = this.endpoints.get(id);
    if (!existing || existing.merchantId !== merchantId) {
      return false;
    }
    return this.endpoints.delete(id);
  }

  async createDelivery(delivery: WebhookDelivery): Promise<WebhookDelivery> {
    this.deliveries.set(delivery.id, cloneDelivery(delivery));
    return cloneDelivery(delivery);
  }

  async findDelivery(merchantId: string, id: string): Promise<WebhookDelivery | undefined> {
    const delivery = this.deliveries.get(id);
    return delivery && delivery.merchantId === merchantId ? cloneDelivery(delivery) : undefined;
  }

  async listDeliveries(endpointId: string, limit: number): Promise<WebhookDelivery[]> {
    return [...this.deliveries.values()]
      .filter((delivery) => delivery.endpointId === endpointId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map(cloneDelivery);
  }

  async listDueDeliveries(now: Date, limit: number): Promise<WebhookDelivery[]> {
    return [...this.deliveries.values()]
      .filter((delivery) => delivery.status === 'pending' && delivery.nextAttemptAt <= now)
      .sort((a, b) => a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime())
      .slice(0, limit)
      .map(cloneDelivery);
  }

  async saveDelivery(delivery: WebhookDelivery): Promise<WebhookDelivery> {
    if (!this.deliveries.has(delivery.id)) {
      throw new NotFoundError('Webhook delivery', delivery.id);
    }
    this.deliveries.set(delivery.id, cloneDelivery(delivery));
    return cloneDelivery(delivery);
  }
}

function cloneEndpoint(endpoint: WebhookEndpoint): WebhookEndpoint {
  return {
    ...endpoint,
    events: [...endpoint.events],
    createdAt: new Date(endpoint.createdAt),
    updatedAt: new Date(endpoint.updatedAt),
  };
}

function cloneDelivery(delivery: WebhookDelivery): WebhookDelivery {
  return {
    ...delivery,
    nextAttemptAt: new Date(delivery.nextAttemptAt),
    lastAttemptAt: delivery.lastAttemptAt ? new Date(delivery.lastAttemptAt) : undefined,
    createdAt: new Date(delivery.createdAt),
    updatedAt: new Date(delivery.updatedAt),
  };
}
