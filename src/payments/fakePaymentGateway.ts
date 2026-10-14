import { newId } from '../lib/ids.js';
import {
  type ChargeRequest,
  type ChargeResult,
  type PaymentGateway,
  PaymentGatewayError,
} from './paymentGateway.js';

/**
 * Deterministic gateway used in development and tests. Behaviour is driven by
 * well-known payment method tokens so flows can be exercised end to end.
 */
export class FakePaymentGateway implements PaymentGateway {
  private readonly results = new Map<string, ChargeResult>();
  readonly requests: ChargeRequest[] = [];

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    this.requests.push(request);

    const previous = this.results.get(request.idempotencyKey);
    if (previous) {
      return previous;
    }

    const result = this.decide(request);
    this.results.set(request.idempotencyKey, result);
    return result;
  }

  private decide(request: ChargeRequest): ChargeResult {
    switch (request.paymentMethodToken) {
      case 'pm_card_declined':
        return { status: 'declined', declineCode: 'card_declined', message: 'The card was declined.' };
      case 'pm_insufficient_funds':
        return {
          status: 'declined',
          declineCode: 'insufficient_funds',
          message: 'The card has insufficient funds.',
        };
      case 'pm_gateway_timeout':
        throw new PaymentGatewayError('Timed out waiting for the payment gateway', true);
      default:
        return { status: 'succeeded', chargeId: newId('ch') };
    }
  }
}
