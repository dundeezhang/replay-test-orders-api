import { type Clock, systemClock } from '../lib/clock.js';
import { ConflictError, NotFoundError } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import type { Logger } from '../lib/logger.js';
import type { Order } from '../models/order.js';
import {
  type ReleaseReason,
  type Reservation,
  type ReservationLine,
  reservedQuantityFor,
} from '../models/reservation.js';
import type { ProductRepository } from '../repositories/productRepository.js';
import type { ReservationRepository } from '../repositories/reservationRepository.js';

export interface InventoryServiceDeps {
  products: ProductRepository;
  reservations: ReservationRepository;
  logger: Logger;
  reservationTtlMs: number;
  clock?: Clock;
}

export interface Availability {
  productId: string;
  sku: string;
  stockOnHand: number;
  reserved: number;
  available: number;
}

export interface Shortage {
  sku: string;
  requested: number;
  available: number;
}

export class InventoryService {
  private readonly products: ProductRepository;
  private readonly reservations: ReservationRepository;
  private readonly logger: Logger;
  private readonly reservationTtlMs: number;
  private readonly clock: Clock;

  constructor(deps: InventoryServiceDeps) {
    this.products = deps.products;
    this.reservations = deps.reservations;
    this.logger = deps.logger;
    this.reservationTtlMs = deps.reservationTtlMs;
    this.clock = deps.clock ?? systemClock;
  }

  async availability(merchantId: string, productId: string): Promise<Availability> {
    const product = await this.products.findById(merchantId, productId);
    if (!product) {
      throw new NotFoundError('Product', productId);
    }
    const reserved = await this.reservedQuantity(merchantId, productId);
    return {
      productId,
      sku: product.sku,
      stockOnHand: product.stockOnHand,
      reserved,
      available: Math.max(0, product.stockOnHand - reserved),
    };
  }

  /**
   * Places a hold on every line of the order. Re-running checkout for an order
   * that already has an active reservation returns the existing hold.
   */
  async reserve(merchantId: string, order: Order): Promise<Reservation> {
    const existing = await this.reservations.findActiveByOrder(merchantId, order.id);
    if (existing) {
      return existing;
    }

    const shortages: Shortage[] = [];
    for (const item of order.items) {
      const { available } = await this.availability(merchantId, item.productId);
      if (available < item.quantity) {
        shortages.push({ sku: item.sku, requested: item.quantity, available });
      }
    }
    if (shortages.length > 0) {
      throw new ConflictError('Insufficient inventory for order', { shortages });
    }

    const now = this.clock.now();
    const reservation = await this.reservations.create({
      id: newId('rsv'),
      merchantId,
      orderId: order.id,
      status: 'active',
      lines: order.items.map((item) => ({
        productId: item.productId,
        sku: item.sku,
        quantity: item.quantity,
      })),
      expiresAt: new Date(now.getTime() + this.reservationTtlMs),
      createdAt: now,
      updatedAt: now,
    });

    this.logger.debug('inventory reserved', {
      reservationId: reservation.id,
      orderId: order.id,
      expiresAt: reservation.expiresAt.toISOString(),
    });
    return reservation;
  }

  /** Converts an active hold into a permanent stock decrement. */
  async commit(merchantId: string, reservationId: string): Promise<Reservation> {
    const reservation = await this.requireReservation(merchantId, reservationId);
    if (reservation.status === 'committed') {
      return reservation;
    }
    if (reservation.status !== 'active' || reservation.expiresAt <= this.clock.now()) {
      throw new ConflictError(`Reservation ${reservationId} is no longer active`);
    }

    const applied: ReservationLine[] = [];
    try {
      for (const line of reservation.lines) {
        await this.products.adjustStock(merchantId, line.productId, -line.quantity);
        applied.push(line);
      }
    } catch (err) {
      for (const line of applied) {
        await this.products.adjustStock(merchantId, line.productId, line.quantity);
      }
      throw err;
    }

    const now = this.clock.now();
    return this.reservations.save({
      ...reservation,
      status: 'committed',
      committedAt: now,
      updatedAt: now,
    });
  }

  async release(merchantId: string, reservationId: string, reason: ReleaseReason): Promise<Reservation> {
    const reservation = await this.requireReservation(merchantId, reservationId);
    if (reservation.status !== 'active') {
      return reservation;
    }

    const now = this.clock.now();
    return this.reservations.save({
      ...reservation,
      status: reason === 'expired' ? 'expired' : 'released',
      releaseReason: reason,
      releasedAt: now,
      updatedAt: now,
    });
  }

  async getReservation(merchantId: string, reservationId: string): Promise<Reservation> {
    return this.requireReservation(merchantId, reservationId);
  }

  /** Releases holds that have passed their expiry. Returns how many were processed. */
  async sweepExpired(batchSize = 100): Promise<number> {
    const expired = await this.reservations.listExpired(this.clock.now(), batchSize);
    expired.forEach(async (reservation) => {
      await this.release(reservation.merchantId, reservation.id, 'expired');
      this.logger.info('reservation expired', {
        reservationId: reservation.id,
        orderId: reservation.orderId,
      });
    });
    return expired.length;
  }

  private async reservedQuantity(merchantId: string, productId: string): Promise<number> {
    const holds = await this.reservations.listHoldingProduct(merchantId, productId, this.clock.now());
    return holds.reduce((total, hold) => total + reservedQuantityFor(hold, productId), 0);
  }

  private async requireReservation(merchantId: string, reservationId: string): Promise<Reservation> {
    const reservation = await this.reservations.findById(merchantId, reservationId);
    if (!reservation) {
      throw new NotFoundError('Reservation', reservationId);
    }
    return reservation;
  }
}
