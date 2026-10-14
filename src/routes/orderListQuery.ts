import { z } from 'zod';
import { type Pagination, pageOffset, PaginationSchema } from '../lib/pagination.js';
import { ORDER_STATUSES } from '../models/order.js';
import type { OrderListFilter, OrderSortField } from '../repositories/orderRepository.js';

const SORT_OPTIONS = ['createdAt', '-createdAt', 'totalCents', '-totalCents'] as const;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const dateParam = z
  .string()
  .regex(DATE_ONLY, 'Expected a date in YYYY-MM-DD format')
  .transform((value) => new Date(value));

const statusParam = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((status) => status.trim())
      .filter((status) => status.length > 0),
  )
  .pipe(z.array(z.enum(ORDER_STATUSES)).min(1));

const OrderListQuerySchema = PaginationSchema.extend({
  status: statusParam.optional(),
  customerId: z.string().trim().min(1).max(64).optional(),
  createdFrom: dateParam.optional(),
  createdTo: dateParam.optional(),
  sort: z.enum(SORT_OPTIONS).default('-createdAt'),
}).refine((query) => !query.createdFrom || !query.createdTo || query.createdFrom <= query.createdTo, {
  message: 'createdFrom must be on or before createdTo',
  path: ['createdFrom'],
});

export interface ParsedOrderListQuery {
  pagination: Pagination;
  filter: OrderListFilter;
}

export function parseOrderListQuery(query: unknown): ParsedOrderListQuery {
  const parsed = OrderListQuerySchema.parse(query);
  const descending = parsed.sort.startsWith('-');
  const field = (descending ? parsed.sort.slice(1) : parsed.sort) as OrderSortField;
  const pagination = { page: parsed.page, pageSize: parsed.pageSize };

  return {
    pagination,
    filter: {
      status: parsed.status,
      customerId: parsed.customerId,
      createdFrom: parsed.createdFrom,
      createdTo: parsed.createdTo,
      sort: { field, direction: descending ? 'desc' : 'asc' },
      offset: pageOffset(pagination),
      limit: pagination.pageSize,
    },
  };
}
