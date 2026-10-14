export type ReservationStatus = 'active' | 'committed' | 'released' | 'expired';

export type ReleaseReason = 'payment_failed' | 'order_cancelled' | 'expired' | 'manual';

export interface ReservationLine {
  productId: string;
  sku: string;
  quantity: number;
}

/**
 * Holds stock for an order between checkout starting and payment completing.
 * Active reservations count against a product's available quantity until they
 * are committed (stock is decremented), released, or expire.
 */
export interface Reservation {
  id: string;
  merchantId: string;
  orderId: string;
  status: ReservationStatus;
  lines: ReservationLine[];
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  committedAt?: Date;
  releasedAt?: Date;
  releaseReason?: ReleaseReason;
}

export function reservedQuantityFor(reservation: Reservation, productId: string): number {
  return reservation.lines
    .filter((line) => line.productId === productId)
    .reduce((total, line) => total + line.quantity, 0);
}
