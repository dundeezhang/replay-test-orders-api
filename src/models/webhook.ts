import type { DomainEventType } from '../events/eventBus.js';

export interface WebhookEndpoint {
  id: string;
  merchantId: string;
  url: string;
  description?: string;
  /** Shared secret used to sign deliveries. Only returned to the client on creation. */
  secret: string;
  events: DomainEventType[];
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type DeliveryStatus = 'pending' | 'succeeded' | 'failed';

export interface WebhookDelivery {
  id: string;
  endpointId: string;
  merchantId: string;
  eventId: string;
  eventType: DomainEventType;
  /** Exact request body; signatures are computed over this string. */
  payload: string;
  status: DeliveryStatus;
  attempts: number;
  nextAttemptAt: Date;
  lastAttemptAt?: Date;
  lastResponseStatus?: number;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}
