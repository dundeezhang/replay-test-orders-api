import { newId } from '../lib/ids.js';
import type { Logger } from '../lib/logger.js';
import type { Order } from '../models/order.js';

export interface DomainEvents {
  'order.created': { order: Order };
  'order.paid': { order: Order };
  'order.cancelled': { order: Order };
}

export type DomainEventType = keyof DomainEvents;

export const DOMAIN_EVENT_TYPES = ['order.created', 'order.paid', 'order.cancelled'] as const satisfies readonly DomainEventType[];

export interface EventMeta {
  id: string;
  type: DomainEventType;
  merchantId: string;
  occurredAt: Date;
}

export type EventHandler<T extends DomainEventType> = (
  payload: DomainEvents[T],
  meta: EventMeta,
) => void | Promise<void>;

/**
 * In-process publish/subscribe. Handlers run asynchronously after the
 * publisher's current task so a slow or failing subscriber can never fail the
 * operation that emitted the event.
 */
export class EventBus {
  private readonly handlers = new Map<DomainEventType, Array<EventHandler<DomainEventType>>>();

  constructor(private readonly logger: Logger) {}

  on<T extends DomainEventType>(type: T, handler: EventHandler<T>): () => void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler as EventHandler<DomainEventType>);
    this.handlers.set(type, list);
    return () => {
      const current = this.handlers.get(type) ?? [];
      this.handlers.set(
        type,
        current.filter((existing) => existing !== handler),
      );
    };
  }

  emit<T extends DomainEventType>(type: T, merchantId: string, payload: DomainEvents[T]): EventMeta {
    const meta: EventMeta = { id: newId('evt'), type, merchantId, occurredAt: new Date() };
    for (const handler of this.handlers.get(type) ?? []) {
      queueMicrotask(() => {
        Promise.resolve()
          .then(() => handler(payload, meta))
          .catch((err: unknown) => {
            this.logger.error('event handler failed', {
              eventId: meta.id,
              type,
              error: err instanceof Error ? err.message : String(err),
            });
          });
      });
    }
    return meta;
  }
}
