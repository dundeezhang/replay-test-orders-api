export const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD'] as const;

export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

export function assertCents(value: number, label = 'amount'): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer number of cents`);
  }
}

export function lineTotalCents(unitPriceCents: number, quantity: number): number {
  assertCents(unitPriceCents, 'unitPriceCents');
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new RangeError('quantity must be a positive integer');
  }
  const total = unitPriceCents * quantity;
  assertCents(total, 'lineTotalCents');
  return total;
}

export function sumCents(values: readonly number[]): number {
  let total = 0;
  for (const value of values) {
    assertCents(value);
    total += value;
  }
  return total;
}

export function formatCents(cents: number, currency: Currency): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}
