import { type Clock, systemClock } from '../lib/clock.js';
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { assertCents } from '../lib/money.js';
import type { NewProduct, Product, ProductPatch } from '../models/product.js';

export interface ProductRepository {
  findById(merchantId: string, id: string): Promise<Product | undefined>;
  findBySku(merchantId: string, sku: string): Promise<Product | undefined>;
  list(merchantId: string): Promise<Product[]>;
  create(merchantId: string, input: NewProduct): Promise<Product>;
  update(merchantId: string, id: string, patch: ProductPatch): Promise<Product>;
  adjustStock(merchantId: string, id: string, delta: number): Promise<Product>;
}

export class InMemoryProductRepository implements ProductRepository {
  private readonly products = new Map<string, Product>();

  constructor(private readonly clock: Clock = systemClock) {}

  async findById(merchantId: string, id: string): Promise<Product | undefined> {
    const product = this.products.get(id);
    return product && product.merchantId === merchantId ? cloneProduct(product) : undefined;
  }

  async findBySku(merchantId: string, sku: string): Promise<Product | undefined> {
    const normalized = sku.toUpperCase();
    for (const product of this.products.values()) {
      if (product.merchantId === merchantId && product.sku === normalized) {
        return cloneProduct(product);
      }
    }
    return undefined;
  }

  async list(merchantId: string): Promise<Product[]> {
    return [...this.products.values()]
      .filter((product) => product.merchantId === merchantId)
      .sort((a, b) => a.sku.localeCompare(b.sku))
      .map(cloneProduct);
  }

  async create(merchantId: string, input: NewProduct): Promise<Product> {
    const sku = input.sku.toUpperCase();
    if (await this.findBySku(merchantId, sku)) {
      throw new ConflictError(`SKU ${sku} already exists`);
    }
    assertCents(input.priceCents, 'priceCents');
    assertStock(input.stockOnHand);

    const now = this.clock.now();
    const product: Product = {
      id: newId('prod'),
      merchantId,
      sku,
      name: input.name,
      priceCents: input.priceCents,
      currency: input.currency,
      stockOnHand: input.stockOnHand,
      active: input.active ?? true,
      createdAt: now,
      updatedAt: now,
    };
    this.products.set(product.id, product);
    return cloneProduct(product);
  }

  async update(merchantId: string, id: string, patch: ProductPatch): Promise<Product> {
    const existing = this.requireOwned(merchantId, id);
    if (patch.priceCents !== undefined) {
      assertCents(patch.priceCents, 'priceCents');
    }
    if (patch.stockOnHand !== undefined) {
      assertStock(patch.stockOnHand);
    }
    const updated: Product = { ...existing, ...patch, updatedAt: this.clock.now() };
    this.products.set(id, updated);
    return cloneProduct(updated);
  }

  async adjustStock(merchantId: string, id: string, delta: number): Promise<Product> {
    if (!Number.isInteger(delta)) {
      throw new ValidationError('Stock adjustments must be whole units');
    }
    const existing = this.requireOwned(merchantId, id);
    const next = existing.stockOnHand + delta;
    if (next < 0) {
      throw new ConflictError(`Insufficient stock for ${existing.sku}`, {
        sku: existing.sku,
        stockOnHand: existing.stockOnHand,
        requested: -delta,
      });
    }
    const updated: Product = { ...existing, stockOnHand: next, updatedAt: this.clock.now() };
    this.products.set(id, updated);
    return cloneProduct(updated);
  }

  private requireOwned(merchantId: string, id: string): Product {
    const existing = this.products.get(id);
    if (!existing || existing.merchantId !== merchantId) {
      throw new NotFoundError('Product', id);
    }
    return existing;
  }
}

function assertStock(value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new ValidationError('stockOnHand must be a non-negative integer');
  }
}

function cloneProduct(product: Product): Product {
  return {
    ...product,
    createdAt: new Date(product.createdAt),
    updatedAt: new Date(product.updatedAt),
  };
}
