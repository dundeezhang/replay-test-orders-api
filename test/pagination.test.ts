import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { buildPageInfo, pageOffset } from '../src/lib/pagination.js';
import { parseOrderListQuery } from '../src/routes/orderListQuery.js';

describe('pagination helpers', () => {
  it('computes zero-based offsets for one-based pages', () => {
    expect(pageOffset({ page: 1, pageSize: 25 })).toBe(0);
    expect(pageOffset({ page: 3, pageSize: 10 })).toBe(20);
  });

  it('builds page info for the first and last pages', () => {
    expect(buildPageInfo({ page: 1, pageSize: 25 }, 100)).toEqual({
      page: 1,
      pageSize: 25,
      totalItems: 100,
      totalPages: 4,
      hasNextPage: true,
      hasPreviousPage: false,
    });
    expect(buildPageInfo({ page: 4, pageSize: 25 }, 100)).toMatchObject({
      hasNextPage: false,
      hasPreviousPage: true,
    });
  });

  it('counts a trailing partial page', () => {
    expect(buildPageInfo({ page: 4, pageSize: 25 }, 101)).toMatchObject({
      totalPages: 5,
      hasNextPage: true,
    });
    expect(buildPageInfo({ page: 1, pageSize: 25 }, 0)).toMatchObject({
      totalPages: 0,
      hasNextPage: false,
    });
  });
});

describe('parseOrderListQuery', () => {
  it('applies defaults', () => {
    const { pagination, filter } = parseOrderListQuery({});
    expect(pagination).toEqual({ page: 1, pageSize: 25 });
    expect(filter).toMatchObject({
      offset: 0,
      limit: 25,
      sort: { field: 'createdAt', direction: 'desc' },
    });
  });

  it('parses comma-separated statuses and sort direction', () => {
    const { filter } = parseOrderListQuery({ status: 'pending, paid', sort: 'totalCents' });
    expect(filter.status).toEqual(['pending', 'paid']);
    expect(filter.sort).toEqual({ field: 'totalCents', direction: 'asc' });
  });

  it('rejects unknown statuses and oversized pages', () => {
    expect(() => parseOrderListQuery({ status: 'shipped' })).toThrow(ZodError);
    expect(() => parseOrderListQuery({ pageSize: '500' })).toThrow(ZodError);
  });

  it('rejects inverted date ranges', () => {
    expect(() => parseOrderListQuery({ createdFrom: '2024-02-01', createdTo: '2024-01-01' })).toThrow(
      ZodError,
    );
  });
});
