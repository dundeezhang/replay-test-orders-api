import type { RequestHandler } from 'express';
import { ConflictError, ValidationError } from '../lib/errors.js';

export interface StoredResponse {
  status: number;
  body: unknown;
  fingerprint: string;
  storedAt: number;
}

export interface IdempotencyOptions {
  ttlMs?: number;
  store?: Map<string, StoredResponse>;
}

const KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const PRUNE_THRESHOLD = 10_000;

/**
 * Replays the stored response when a client retries a request with the same
 * Idempotency-Key, so network retries never create duplicate resources.
 */
export function idempotency(options: IdempotencyOptions = {}): RequestHandler {
  const ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1000;
  const store = options.store ?? new Map<string, StoredResponse>();

  return (req, res, next) => {
    const key = req.header('idempotency-key');
    if (key === undefined) {
      next();
      return;
    }
    if (!KEY_PATTERN.test(key)) {
      next(new ValidationError('Idempotency-Key must be 8-128 letters, digits, dashes or underscores'));
      return;
    }

    const now = Date.now();
    const fingerprint = JSON.stringify(req.body ?? null);
    const stored = store.get(key);
    if (stored && now - stored.storedAt < ttlMs) {
      if (stored.fingerprint !== fingerprint) {
        next(new ConflictError('Idempotency-Key was already used with a different request'));
        return;
      }
      res.setHeader('idempotent-replayed', 'true');
      res.status(stored.status).json(stored.body);
      return;
    }

    const send = res.json.bind(res);
    res.json = (body: unknown) => {
      if (res.statusCode < 500) {
        store.set(key, { status: res.statusCode, body, fingerprint, storedAt: now });
        if (store.size > PRUNE_THRESHOLD) {
          for (const [storedKey, entry] of store) {
            if (now - entry.storedAt >= ttlMs) {
              store.delete(storedKey);
            }
          }
        }
      }
      return send(body);
    };
    next();
  };
}
