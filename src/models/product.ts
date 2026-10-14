import type { Currency } from '../lib/money.js';

export interface Product {
  id: string;
  merchantId: string;
  sku: string;
  name: string;
  priceCents: number;
  currency: Currency;
  stockOnHand: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type NewProduct = Pick<Product, 'sku' | 'name' | 'priceCents' | 'currency' | 'stockOnHand'> & {
  active?: boolean;
};

export type ProductPatch = Partial<Pick<Product, 'name' | 'priceCents' | 'stockOnHand' | 'active'>>;
