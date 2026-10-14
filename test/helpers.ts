import type { ApiKeyEntry } from '../src/config.js';
import { manualClock } from '../src/lib/clock.js';
import { silentLogger } from '../src/lib/logger.js';
import type { Principal } from '../src/models/principal.js';
import { InMemoryOrderRepository } from '../src/repositories/orderRepository.js';
import { InMemoryProductRepository } from '../src/repositories/productRepository.js';
import { createApp } from '../src/server.js';
import { OrderService } from '../src/services/orderService.js';

export const MERCHANT_A = 'merchant_a';
export const MERCHANT_B = 'merchant_b';

export const TEST_KEYS = {
  adminA: 'test-admin-key-a',
  staffA: 'test-staff-key-a',
  adminB: 'test-admin-key-b',
} as const;

export const TEST_API_KEYS: ApiKeyEntry[] = [
  { merchantId: MERCHANT_A, role: 'admin', key: TEST_KEYS.adminA },
  { merchantId: MERCHANT_A, role: 'staff', key: TEST_KEYS.staffA },
  { merchantId: MERCHANT_B, role: 'admin', key: TEST_KEYS.adminB },
];

export function principal(merchantId = MERCHANT_A, role: Principal['role'] = 'admin'): Principal {
  return { merchantId, role, keyId: 'test' };
}

export function bearer(key: string): Record<string, string> {
  return { authorization: `Bearer ${key}` };
}

export function buildTestContext() {
  const clock = manualClock();
  const products = new InMemoryProductRepository(clock);
  const orders = new InMemoryOrderRepository();
  const orderService = new OrderService({ orders, products, clock });
  const app = createApp({ logger: silentLogger, apiKeys: TEST_API_KEYS, products, orderService });
  return { clock, products, orders, orderService, app };
}
