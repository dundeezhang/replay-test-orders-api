import { describe, expect, it } from 'vitest';
import { generateSigningSecret, signPayload, verifySignature } from '../src/webhooks/signing.js';

describe('webhook signing', () => {
  const secret = 'test-signing-secret';
  const body = JSON.stringify({ id: 'evt_1', type: 'order.paid' });

  it('round-trips a signature', () => {
    const header = signPayload(secret, 1_700_000_000, body);
    expect(header).toMatch(/^t=1700000000,v1=[0-9a-f]{64}$/);
    expect(verifySignature(secret, header, body, 1_700_000_010)).toBe(true);
  });

  it('rejects tampered bodies and wrong secrets', () => {
    const header = signPayload(secret, 1_700_000_000, body);
    expect(verifySignature(secret, header, `${body} `, 1_700_000_000)).toBe(false);
    expect(verifySignature('another-secret', header, body, 1_700_000_000)).toBe(false);
  });

  it('rejects stale timestamps and malformed headers', () => {
    const header = signPayload(secret, 1_700_000_000, body);
    expect(verifySignature(secret, header, body, 1_700_000_000 + 301)).toBe(false);
    expect(verifySignature(secret, 'v1=abc', body, 1_700_000_000)).toBe(false);
  });

  it('generates distinct secrets', () => {
    expect(generateSigningSecret()).not.toBe(generateSigningSecret());
  });
});
