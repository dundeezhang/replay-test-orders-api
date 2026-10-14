import type { DomainEventType, EventBus } from '../events/eventBus.js';
import { type Clock, systemClock } from '../lib/clock.js';
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { type Currency, lineTotalCents, sumCents } from '../lib/money.js';
import { canTransition, type Order, type OrderItem, type OrderStatus } from '../models/order.js';
import type { Principal } from '../models/principal.js';
import type { OrderListFilter, OrderListResult, OrderRepository } from '../repositories/orderRepository.js';
import type { ProductRepository } from '../repositories/productRepository.js';

export interface CreateOrderInput {
  customerId: string;
  currency: Currency;
  items: Array<{ productId: string; quantity: number }>;
}

export interface OrderServiceDeps {
  orders: OrderRepository;
  products: ProductRepository;
  events?: EventBus;
  clock?: Clock;
}

export class OrderService {
  private readonly orders: OrderRepository;
  private readonly products: ProductRepository;
  private readonly events?: EventBus;
  private readonly clock: Clock;

  constructor(deps: OrderServiceDeps) {
    this.orders = deps.orders;
    this.products = deps.products;
    this.events = deps.events;
    this.clock = deps.clock ?? systemClock;
  }

  async createOrder(principal: Principal, input: CreateOrderInput): Promise<Order> {
    if (input.items.length === 0) {
      throw new ValidationError('Order must contain at least one item');
    }

    const items: OrderItem[] = [];
    for (const line of mergeLineItems(input.items)) {
      const product = await this.products.findById(principal.merchantId, line.productId);
      if (!product || !product.active) {
        throw new ValidationError(`Product ${line.productId} is not available`);
      }
      if (product.currency !== input.currency) {
        throw new ValidationError(
          `Product ${product.sku} is priced in ${product.currency}, not ${input.currency}`,
        );
      }
      items.push({
        productId: product.id,
        sku: product.sku,
        name: product.name,
        quantity: line.quantity,
        unitPriceCents: product.priceCents,
        lineTotalCents: lineTotalCents(product.priceCents, line.quantity),
      });
    }

    const subtotalCents = sumCents(items.map((item) => item.lineTotalCents));
    const now = this.clock.now();
    const order: Order = {
      id: newId('ord'),
      merchantId: principal.merchantId,
      customerId: input.customerId,
      status: 'pending',
      currency: input.currency,
      items,
      subtotalCents,
      totalCents: subtotalCents,
      createdAt: now,
      updatedAt: now,
    };
    const created = await this.orders.create(order);
    this.events?.emit('order.created', created.merchantId, { order: created });
    return created;
  }

  async getOrder(principal: Principal, id: string): Promise<Order> {
    const order = await this.orders.findById(principal.merchantId, id);
    if (!order) {
      throw new NotFoundError('Order', id);
    }
    return order;
  }

  async listOrders(principal: Principal): Promise<Order[]> {
    return this.orders.list(principal.merchantId);
  }

  async queryOrders(principal: Principal, filter: OrderListFilter): Promise<OrderListResult> {
    return this.orders.query(principal.merchantId, filter);
  }

  async markPaid(principal: Principal, id: string): Promise<Order> {
    return this.transition(principal, id, 'paid');
  }

  async cancelOrder(principal: Principal, id: string): Promise<Order> {
    return this.transition(principal, id, 'cancelled');
  }

  private async transition(principal: Principal, id: string, to: OrderStatus): Promise<Order> {
    const order = await this.getOrder(principal, id);
    if (!canTransition(order.status, to)) {
      throw new ConflictError(`Cannot move order ${id} from ${order.status} to ${to}`);
    }

    const now = this.clock.now();
    const updated: Order = {
      ...order,
      status: to,
      updatedAt: now,
      paidAt: to === 'paid' ? now : order.paidAt,
      cancelledAt: to === 'cancelled' ? now : order.cancelledAt,
    };
    const saved = await this.orders.save(updated);
    const eventType = STATUS_EVENTS[to];
    if (eventType) {
      this.events?.emit(eventType, saved.merchantId, { order: saved });
    }
    return saved;
  }
}

const STATUS_EVENTS: Partial<Record<OrderStatus, DomainEventType>> = {
  paid: 'order.paid',
  cancelled: 'order.cancelled',
};

function mergeLineItems(
  items: ReadonlyArray<{ productId: string; quantity: number }>,
): Array<{ productId: string; quantity: number }> {
  const quantities = new Map<string, number>();
  for (const item of items) {
    quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
  }
  return [...quantities].map(([productId, quantity]) => ({ productId, quantity }));
}
