import type { Principal } from '../models/principal.js';

declare global {
  namespace Express {
    interface Request {
      principal?: Principal;
      requestId?: string;
    }
  }
}

export {};
