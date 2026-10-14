import type { Currency } from '../lib/money.js';

export interface ChargeRequest {
  merchantId: string;
  orderId: string;
  amountCents: number;
  currency: Currency;
  paymentMethodToken: string;
  /** Repeated calls with the same key must not create a second charge. */
  idempotencyKey: string;
}

export type ChargeResult =
  | { status: 'succeeded'; chargeId: string }
  | { status: 'declined'; declineCode: string; message: string };

export interface PaymentGateway {
  charge(request: ChargeRequest): Promise<ChargeResult>;
}

export class PaymentGatewayError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'PaymentGatewayError';
  }
}
