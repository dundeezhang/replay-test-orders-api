import { beforeEach, describe, expect, it } from 'vitest';
import { manualClock, type ManualClock } from '../src/lib/clock.js';
import { ConflictError } from '../src/lib/errors.js';
import { silentLogger } from '../src/lib/logger.js';
import type { Order } from '../src/models/order.js';
import type { Product } from '../src/models/product.js';
import { InMemoryOrderRepository } from '../src/repositories/orderRepository.js';
import { InMemoryProductRepository } from '../src/repositories/productRepository.js';
import { InMemoryReservationRepository } from '../src/repositories/reservationRepository.js';
import { InventoryService } from '../src/services/inventoryService.js';
import { OrderService } from '../src/services/orderService.js';
import { MERCHANT_A, MERCHANT_B, principal } from './helpers.js';

const TTL_MS = 15 * 60 * 1000;

describe('InventoryService', () => {
  let clock: ManualClock;
  let products: InMemoryProductRepository;
  let orderService: OrderService;
  let inventory: InventoryService;
  let hoodie: Product;

  async function orderFor(quantity: number): Promise<Order> {
    return orderService.createOrder(principal(), {
      customerId: 'cus_1',
      currency: 'USD',
      items: [{ productId: hoodie.id, quantity }],
    });
  }

  beforeEach(async () => {
    clock = manualClock();
    products = new InMemoryProductRepository(clock);
    orderService = new OrderService({ orders: new InMemoryOrderRepository(), products, clock });
    inventory = new InventoryService({
      products,
      reservations: new InMemoryReservationRepository(),
      logger: silentLogger,
      reservationTtlMs: TTL_MS,
      clock,
    });
    hoodie = await products.create(MERCHANT_A, {
      sku: 'HOOD-GRY-L',
      name: 'Zip Hoodie',
      priceCents: 6800,
      currency: 'USD',
      stockOnHand: 5,
    });
  });

  it('holds stock without decrementing on-hand quantity', async () => {
    const order = await orderFor(2);
    const reservation = await inventory.reserve(MERCHANT_A, order);

    expect(reservation.status).toBe('active');
    expect(reservation.expiresAt.getTime() - clock.now().getTime()).toBe(TTL_MS);
    expect(await inventory.availability(MERCHANT_A, hoodie.id)).toMatchObject({
      stockOnHand: 5,
      reserved: 2,
      available: 3,
    });
  });

  it('reports shortages when there is not enough available stock', async () => {
    await inventory.reserve(MERCHANT_A, await orderFor(4));

    const error = await inventory.reserve(MERCHANT_A, await orderFor(2)).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).details).toEqual({
      shortages: [{ sku: 'HOOD-GRY-L', requested: 2, available: 1 }],
    });
  });

  it('returns the existing hold when an order is checked out twice', async () => {
    const order = await orderFor(2);
    const first = await inventory.reserve(MERCHANT_A, order);
    const second = await inventory.reserve(MERCHANT_A, order);

    expect(second.id).toBe(first.id);
    expect((await inventory.availability(MERCHANT_A, hoodie.id)).reserved).toBe(2);
  });

  it('decrements stock when a reservation is committed', async () => {
    const reservation = await inventory.reserve(MERCHANT_A, await orderFor(3));
    const committed = await inventory.commit(MERCHANT_A, reservation.id);

    expect(committed.status).toBe('committed');
    expect(await inventory.availability(MERCHANT_A, hoodie.id)).toMatchObject({
      stockOnHand: 2,
      reserved: 0,
      available: 2,
    });
  });

  it('refuses to commit a reservation after it expires', async () => {
    const reservation = await inventory.reserve(MERCHANT_A, await orderFor(1));
    clock.advance(TTL_MS);

    await expect(inventory.commit(MERCHANT_A, reservation.id)).rejects.toBeInstanceOf(ConflictError);
    expect((await products.findById(MERCHANT_A, hoodie.id))?.stockOnHand).toBe(5);
  });

  it('frees stock when a reservation is released', async () => {
    const reservation = await inventory.reserve(MERCHANT_A, await orderFor(5));
    const released = await inventory.release(MERCHANT_A, reservation.id, 'payment_failed');

    expect(released).toMatchObject({ status: 'released', releaseReason: 'payment_failed' });
    expect((await inventory.availability(MERCHANT_A, hoodie.id)).available).toBe(5);
  });

  it('stops counting expired holds against availability', async () => {
    await inventory.reserve(MERCHANT_A, await orderFor(5));
    expect((await inventory.availability(MERCHANT_A, hoodie.id)).available).toBe(0);

    clock.advance(TTL_MS + 1);
    expect((await inventory.availability(MERCHANT_A, hoodie.id)).available).toBe(5);
  });

  it('picks up expired reservations in the sweep', async () => {
    await inventory.reserve(MERCHANT_A, await orderFor(1));
    await inventory.reserve(MERCHANT_A, await orderFor(1));
    expect(await inventory.sweepExpired()).toBe(0);

    clock.advance(TTL_MS);
    expect(await inventory.sweepExpired()).toBe(2);
    expect(await inventory.sweepExpired()).toBe(0);
  });

  it('marks swept reservations as expired', async () => {
    const reservation = await inventory.reserve(MERCHANT_A, await orderFor(1));
    clock.advance(TTL_MS);
    await inventory.sweepExpired();

    expect(await inventory.getReservation(MERCHANT_A, reservation.id)).toMatchObject({
      status: 'expired',
      releaseReason: 'expired',
    });
  });

  it('scopes reservations to the owning merchant', async () => {
    const reservation = await inventory.reserve(MERCHANT_A, await orderFor(1));
    await expect(inventory.getReservation(MERCHANT_B, reservation.id)).rejects.toThrow(/not found/);
  });
});
