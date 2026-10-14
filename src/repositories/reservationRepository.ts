import { ConflictError, NotFoundError } from '../lib/errors.js';
import type { Reservation } from '../models/reservation.js';

export interface ReservationRepository {
  create(reservation: Reservation): Promise<Reservation>;
  findById(merchantId: string, id: string): Promise<Reservation | undefined>;
  findActiveByOrder(merchantId: string, orderId: string): Promise<Reservation | undefined>;
  /** Active, unexpired reservations that hold stock for the given product. */
  listHoldingProduct(merchantId: string, productId: string, now: Date): Promise<Reservation[]>;
  /** Active reservations whose expiry is at or before `now`, oldest first. */
  listExpired(now: Date, limit: number): Promise<Reservation[]>;
  save(reservation: Reservation): Promise<Reservation>;
}

export class InMemoryReservationRepository implements ReservationRepository {
  private readonly reservations = new Map<string, Reservation>();

  async create(reservation: Reservation): Promise<Reservation> {
    if (this.reservations.has(reservation.id)) {
      throw new ConflictError(`Reservation ${reservation.id} already exists`);
    }
    this.reservations.set(reservation.id, cloneReservation(reservation));
    return cloneReservation(reservation);
  }

  async findById(merchantId: string, id: string): Promise<Reservation | undefined> {
    const reservation = this.reservations.get(id);
    return reservation && reservation.merchantId === merchantId ? cloneReservation(reservation) : undefined;
  }

  async findActiveByOrder(merchantId: string, orderId: string): Promise<Reservation | undefined> {
    for (const reservation of this.reservations.values()) {
      if (
        reservation.merchantId === merchantId &&
        reservation.orderId === orderId &&
        reservation.status === 'active'
      ) {
        return cloneReservation(reservation);
      }
    }
    return undefined;
  }

  async listHoldingProduct(merchantId: string, productId: string, now: Date): Promise<Reservation[]> {
    return [...this.reservations.values()]
      .filter(
        (reservation) =>
          reservation.merchantId === merchantId &&
          reservation.status === 'active' &&
          reservation.expiresAt > now &&
          reservation.lines.some((line) => line.productId === productId),
      )
      .map(cloneReservation);
  }

  async listExpired(now: Date, limit: number): Promise<Reservation[]> {
    return [...this.reservations.values()]
      .filter((reservation) => reservation.status === 'active' && reservation.expiresAt <= now)
      .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime())
      .slice(0, limit)
      .map(cloneReservation);
  }

  async save(reservation: Reservation): Promise<Reservation> {
    const existing = this.reservations.get(reservation.id);
    if (!existing || existing.merchantId !== reservation.merchantId) {
      throw new NotFoundError('Reservation', reservation.id);
    }
    this.reservations.set(reservation.id, cloneReservation(reservation));
    return cloneReservation(reservation);
  }
}

function cloneReservation(reservation: Reservation): Reservation {
  return {
    ...reservation,
    lines: reservation.lines.map((line) => ({ ...line })),
    expiresAt: new Date(reservation.expiresAt),
    createdAt: new Date(reservation.createdAt),
    updatedAt: new Date(reservation.updatedAt),
    committedAt: reservation.committedAt ? new Date(reservation.committedAt) : undefined,
    releasedAt: reservation.releasedAt ? new Date(reservation.releasedAt) : undefined,
  };
}
