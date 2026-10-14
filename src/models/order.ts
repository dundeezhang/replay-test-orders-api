import type { Currency } from '../lib/money.js';

export const ORDER_STATUSES = ['pending', 'paid', 'fulfilled', 'cancelled'] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export interface OrderItem {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
}

export interface Order {
  id: string;
  merchantId: string;
  customerId: string;
  status: OrderStatus;
  currency: Currency;
  items: OrderItem[];
  subtotalCents: number;
  discountCents: number;
  couponCode?: string;
  totalCents: number;
  createdAt: Date;
  updatedAt: Date;
  paidAt?: Date;
  cancelledAt?: Date;
}

const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ['paid', 'cancelled'],
  paid: ['fulfilled', 'cancelled'],
  fulfilled: [],
  cancelled: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}
