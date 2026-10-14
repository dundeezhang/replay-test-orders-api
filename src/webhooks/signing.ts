import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_HEADER = 'x-orders-signature';

const SCHEME = 'v1';

export function generateSigningSecret(): string {
  return `ordwh_${randomBytes(24).toString('base64url')}`;
}

/**
 * Signature header format: `t=<unix seconds>,v1=<hex hmac-sha256>` where the
 * HMAC covers `${t}.${body}`. Including the timestamp lets receivers reject
 * replayed deliveries.
 */
export function signPayload(secret: string, timestampSeconds: number, body: string): string {
  return `t=${timestampSeconds},${SCHEME}=${hmac(secret, timestampSeconds, body)}`;
}

/** Reference verifier for receivers; also used by our own tests. */
export function verifySignature(
  secret: string,
  header: string,
  body: string,
  nowSeconds: number,
  toleranceSeconds = 300,
): boolean {
  const parts = new Map(
    header.split(',').map((part) => {
      const [key = '', value = ''] = part.split('=', 2);
      return [key.trim(), value.trim()] as const;
    }),
  );
  const timestamp = Number(parts.get('t'));
  const signature = parts.get(SCHEME);
  if (!Number.isInteger(timestamp) || !signature) {
    return false;
  }
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
    return false;
  }

  const expected = Buffer.from(hmac(secret, timestamp, body), 'hex');
  const provided = Buffer.from(signature, 'hex');
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

function hmac(secret: string, timestampSeconds: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestampSeconds}.${body}`).digest('hex');
}
