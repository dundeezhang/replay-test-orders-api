import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { silentLogger } from '../src/lib/logger.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { rateLimit, type RateLimitOptions } from '../src/middleware/rateLimit.js';

function appWith(options: Partial<RateLimitOptions>) {
  const app = express();
  app.use(rateLimit(options));
  app.get('/', (_req, res) => {
    res.json({ ok: true });
  });
  app.use(errorHandler(silentLogger));
  return app;
}

describe('rateLimit', () => {
  it('allows requests up to the limit and rejects the rest', async () => {
    const app = appWith({ max: 2, windowMs: 60_000 });
    const client = { 'x-forwarded-for': '203.0.113.10' };

    expect((await request(app).get('/').set(client)).status).toBe(200);
    const second = await request(app).get('/').set(client);
    expect(second.status).toBe(200);
    expect(second.headers['ratelimit-remaining']).toBe('0');

    const third = await request(app).get('/').set(client);
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe('rate_limited');
    expect(third.headers['retry-after']).toBeDefined();
  });

  it('tracks clients independently', async () => {
    const app = appWith({ max: 1, windowMs: 60_000 });

    expect((await request(app).get('/').set('x-forwarded-for', '203.0.113.20')).status).toBe(200);
    expect((await request(app).get('/').set('x-forwarded-for', '203.0.113.21')).status).toBe(200);
  });
});
