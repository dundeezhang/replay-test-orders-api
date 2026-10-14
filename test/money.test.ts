import { describe, expect, it } from 'vitest';
import { assertCents, formatCents, lineTotalCents, sumCents } from '../src/lib/money.js';

describe('money', () => {
  it('rejects fractional and negative cents', () => {
    expect(() => assertCents(10.5)).toThrow(RangeError);
    expect(() => assertCents(-1)).toThrow(RangeError);
    expect(() => assertCents(0)).not.toThrow();
  });

  it('multiplies unit price by quantity', () => {
    expect(lineTotalCents(1999, 3)).toBe(5997);
  });

  it('rejects non-positive quantities', () => {
    expect(() => lineTotalCents(1999, 0)).toThrow(RangeError);
    expect(() => lineTotalCents(1999, 1.5)).toThrow(RangeError);
  });

  it('sums integer cents exactly', () => {
    expect(sumCents([10, 20, 70])).toBe(100);
    expect(sumCents([])).toBe(0);
  });

  it('formats cents for display', () => {
    expect(formatCents(123456, 'USD')).toBe('$1,234.56');
  });
});
