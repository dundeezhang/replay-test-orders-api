import { AppError, ConflictError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import type { Order } from '../models/order.js';
import type { Principal } from '../models/principal.js';
import type { Reservation } from '../models/reservation.js';
import type { ChargeResult, PaymentGateway } from '../payments/paymentGateway.js';
import type { InventoryService } from './inventoryService.js';
import type { OrderService } from './orderService.js';

export interface CheckoutInput {
  paymentMethodToken: string;
}

export interface CheckoutResult {
  order: Order;
  reservation: Reservation;
  chargeId: string;
}

export interface CheckoutServiceDeps {
  orders: OrderService;
  inventory: InventoryService;
  payments: PaymentGateway;
  logger: Logger;
}

/**
 * Checkout flow: reserve stock -> charge -> commit stock -> mark the order paid.
 * Any failure before the charge succeeds releases the reservation so the stock
 * becomes available to other shoppers immediately instead of waiting for expiry.
 */
export class CheckoutService {
  private readonly orders: OrderService;
  private readonly inventory: InventoryService;
  private readonly payments: PaymentGateway;
  private readonly logger: Logger;

  constructor(deps: CheckoutServiceDeps) {
    this.orders = deps.orders;
    this.inventory = deps.inventory;
    this.payments = deps.payments;
    this.logger = deps.logger;
  }

  async checkout(principal: Principal, orderId: string, input: CheckoutInput): Promise<CheckoutResult> {
    const order = await this.orders.getOrder(principal, orderId);
    if (order.status !== 'pending') {
      throw new ConflictError(`Order ${orderId} is ${order.status} and cannot be checked out`);
    }

    const reservation = await this.inventory.reserve(principal.merchantId, order);
    const log = this.logger.child({ orderId, reservationId: reservation.id });

    let charge: ChargeResult;
    try {
      charge = await this.payments.charge({
        merchantId: principal.merchantId,
        orderId,
        amountCents: order.totalCents,
        currency: order.currency,
        paymentMethodToken: input.paymentMethodToken,
        idempotencyKey: `checkout:${reservation.id}`,
      });
    } catch (err) {
      log.error('payment gateway error', { error: err instanceof Error ? err.message : String(err) });
      await this.inventory.release(principal.merchantId, reservation.id, 'payment_failed');
      throw new AppError('Payment provider is unavailable, please retry', 503, 'payment_unavailable');
    }

    if (charge.status === 'declined') {
      log.info('payment declined', { declineCode: charge.declineCode });
      await this.inventory.release(principal.merchantId, reservation.id, 'payment_failed');
      throw new AppError(charge.message, 402, 'payment_declined', { declineCode: charge.declineCode });
    }

    const committed = await this.inventory.commit(principal.merchantId, reservation.id);
    const paid = await this.orders.markPaid(principal, orderId);
    log.info('checkout completed', { chargeId: charge.chargeId, totalCents: paid.totalCents });

    return { order: paid, reservation: committed, chargeId: charge.chargeId };
  }
}
