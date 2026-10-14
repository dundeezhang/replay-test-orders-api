import { ConflictError, NotFoundError } from '../lib/errors.js';
import type { Order, OrderStatus } from '../models/order.js';

export type OrderSortField = 'createdAt' | 'totalCents';

export interface OrderListFilter {
  status?: OrderStatus[];
  customerId?: string;
  createdFrom?: Date;
  createdTo?: Date;
  sort: { field: OrderSortField; direction: 'asc' | 'desc' };
  offset: number;
  limit: number;
}

export interface OrderListResult {
  orders: Order[];
  total: number;
}

export interface OrderRepository {
  create(order: Order): Promise<Order>;
  findById(merchantId: string, id: string): Promise<Order | undefined>;
  list(merchantId: string): Promise<Order[]>;
  query(merchantId: string, filter: OrderListFilter): Promise<OrderListResult>;
  save(order: Order): Promise<Order>;
}

export class InMemoryOrderRepository implements OrderRepository {
  private readonly orders = new Map<string, Order>();

  async create(order: Order): Promise<Order> {
    if (this.orders.has(order.id)) {
      throw new ConflictError(`Order ${order.id} already exists`);
    }
    this.orders.set(order.id, cloneOrder(order));
    return cloneOrder(order);
  }

  async findById(merchantId: string, id: string): Promise<Order | undefined> {
    const order = this.orders.get(id);
    return order && order.merchantId === merchantId ? cloneOrder(order) : undefined;
  }

  async list(merchantId: string): Promise<Order[]> {
    return [...this.orders.values()]
      .filter((order) => order.merchantId === merchantId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(cloneOrder);
  }

  async query(merchantId: string, filter: OrderListFilter): Promise<OrderListResult> {
    const matching = [...this.orders.values()].filter(
      (order) => order.merchantId === merchantId && matchesFilter(order, filter),
    );
    const direction = filter.sort.direction === 'asc' ? 1 : -1;
    matching.sort((a, b) => direction * compareOrders(filter.sort.field, a, b));

    return {
      orders: matching.slice(filter.offset, filter.offset + filter.limit).map(cloneOrder),
      total: matching.length,
    };
  }

  async save(order: Order): Promise<Order> {
    const existing = this.orders.get(order.id);
    if (!existing || existing.merchantId !== order.merchantId) {
      throw new NotFoundError('Order', order.id);
    }
    this.orders.set(order.id, cloneOrder(order));
    return cloneOrder(order);
  }
}

function matchesFilter(order: Order, filter: OrderListFilter): boolean {
  if (filter.status && !filter.status.includes(order.status)) {
    return false;
  }
  if (filter.customerId && order.customerId !== filter.customerId) {
    return false;
  }
  if (filter.createdFrom && order.createdAt < filter.createdFrom) {
    return false;
  }
  if (filter.createdTo && order.createdAt > filter.createdTo) {
    return false;
  }
  return true;
}

function compareOrders(field: OrderSortField, a: Order, b: Order): number {
  const byCreatedAt = a.createdAt.getTime() - b.createdAt.getTime();
  if (field === 'totalCents') {
    return a.totalCents - b.totalCents || byCreatedAt || a.id.localeCompare(b.id);
  }
  return byCreatedAt || a.id.localeCompare(b.id);
}

export function cloneOrder(order: Order): Order {
  return {
    ...order,
    items: order.items.map((item) => ({ ...item })),
    createdAt: new Date(order.createdAt),
    updatedAt: new Date(order.updatedAt),
    paidAt: order.paidAt ? new Date(order.paidAt) : undefined,
    cancelledAt: order.cancelledAt ? new Date(order.cancelledAt) : undefined,
  };
}
