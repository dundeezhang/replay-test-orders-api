import type { Role } from '../config.js';

export interface Principal {
  merchantId: string;
  role: Role;
  /** Short, non-reversible fingerprint of the API key used, safe for logs. */
  keyId: string;
}
