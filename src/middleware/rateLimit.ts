import type { Request, RequestHandler } from 'express';
import { AppError } from '../lib/errors.js';

interface Bucket {
  count: number;
  windowStart: number;
}

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyGenerator: (req: Request) => string;
  buckets: Map<string, Bucket>;
}

const MAX_TRACKED_KEYS = 10_000;

const DEFAULT_OPTIONS: RateLimitOptions = {
  windowMs: 60_000,
  max: 120,
  keyGenerator: clientKey,
  buckets: new Map(),
};

/** Fixed-window limiter keyed by client address. */
export function rateLimit(options: Partial<RateLimitOptions> = {}): RequestHandler {
  const { windowMs, max, keyGenerator, buckets } = { ...DEFAULT_OPTIONS, ...options };

  return (req, res, next) => {
    const now = Date.now();
    const key = keyGenerator(req);

    let bucket = buckets.get(key);
    if (!bucket || now - bucket.windowStart >= windowMs) {
      bucket = { count: 0, windowStart: now };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    if (buckets.size > MAX_TRACKED_KEYS) {
      for (const [trackedKey, tracked] of buckets) {
        if (now - tracked.windowStart >= windowMs) {
          buckets.delete(trackedKey);
        }
      }
    }

    const resetMs = bucket.windowStart + windowMs - now;
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
    res.setHeader('RateLimit-Reset', String(Math.ceil(resetMs / 1000)));

    if (bucket.count > max) {
      res.setHeader('Retry-After', String(resetMs));
      next(new AppError('Too many requests, slow down', 429, 'rate_limited'));
      return;
    }
    next();
  };
}

export function clientKey(req: Request): string {
  const forwarded = req.header('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0]!.trim();
  }
  return req.socket.remoteAddress ?? 'unknown';
}
