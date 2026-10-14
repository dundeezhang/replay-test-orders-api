import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request, RequestHandler } from 'express';
import type { ApiKeyEntry, Role } from '../config.js';
import { ForbiddenError, UnauthorizedError } from '../lib/errors.js';
import type { Principal } from '../models/principal.js';

interface IndexedKey {
  merchantId: string;
  role: Role;
  digest: Buffer;
}

export function authenticate(entries: readonly ApiKeyEntry[]): RequestHandler {
  const keys: IndexedKey[] = entries.map((entry) => ({
    merchantId: entry.merchantId,
    role: entry.role,
    digest: sha256(entry.key),
  }));

  return (req, _res, next) => {
    const header = req.header('authorization');
    if (!header || !header.startsWith('Bearer ')) {
      next(new UnauthorizedError());
      return;
    }

    const presented = sha256(header.slice('Bearer '.length).trim());
    const match = keys.find((key) => timingSafeEqual(key.digest, presented));
    if (!match) {
      next(new UnauthorizedError('Invalid API key'));
      return;
    }

    req.principal = {
      merchantId: match.merchantId,
      role: match.role,
      keyId: match.digest.toString('hex').slice(0, 12),
    };
    next();
  };
}

export function requireRole(role: Role): RequestHandler {
  return (req, _res, next) => {
    if (!req.principal) {
      next(new UnauthorizedError());
      return;
    }
    if (role === 'admin' && req.principal.role !== 'admin') {
      next(new ForbiddenError('This action requires an admin API key'));
      return;
    }
    next();
  };
}

export function principalOf(req: Request): Principal {
  if (!req.principal) {
    throw new UnauthorizedError();
  }
  return req.principal;
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}
