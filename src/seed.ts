import type { ApiKeyEntry } from './config.js';
import type { NewProduct } from './models/product.js';
import type { ProductRepository } from './repositories/productRepository.js';

const DEMO_PRODUCTS: readonly NewProduct[] = [
  { sku: 'TEE-BLK-M', name: 'Classic Tee - Black / M', priceCents: 2400, currency: 'USD', stockOnHand: 120 },
  { sku: 'TEE-WHT-M', name: 'Classic Tee - White / M', priceCents: 2400, currency: 'USD', stockOnHand: 85 },
  { sku: 'HOOD-GRY-L', name: 'Zip Hoodie - Grey / L', priceCents: 6800, currency: 'USD', stockOnHand: 40 },
  { sku: 'MUG-12OZ', name: 'Enamel Mug 12oz', priceCents: 1800, currency: 'USD', stockOnHand: 300 },
  { sku: 'CAP-NVY', name: 'Dad Cap - Navy', priceCents: 2200, currency: 'USD', stockOnHand: 0, active: false },
];

/**
 * Seeds the demo catalog for every merchant that has an API key configured.
 * Safe to run repeatedly: existing SKUs are left untouched.
 */
export async function seedDemoData(
  products: ProductRepository,
  apiKeys: readonly ApiKeyEntry[],
): Promise<number> {
  const merchants = [...new Set(apiKeys.map((entry) => entry.merchantId))];
  let created = 0;
  for (const merchantId of merchants) {
    for (const product of DEMO_PRODUCTS) {
      const existing = await products.findBySku(merchantId, product.sku);
      if (!existing) {
        await products.create(merchantId, product);
        created += 1;
      }
    }
  }
  return created;
}
