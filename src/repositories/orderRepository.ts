import { ConflictError, NotFoundError } from '../lib/errors.js';
import type { Order } from '../models/order.js';

export interface OrderRepository {
  create(order: Order): Promise<Order>;
  findById(merchantId: string, id: string): Promise<Order | undefined>;
  list(merchantId: string): Promise<Order[]>;
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

  async save(order: Order): Promise<Order> {
    const existing = this.orders.get(order.id);
    if (!existing || existing.merchantId !== order.merchantId) {
      throw new NotFoundError('Order', order.id);
    }
    this.orders.set(order.id, cloneOrder(order));
    return cloneOrder(order);
  }
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
