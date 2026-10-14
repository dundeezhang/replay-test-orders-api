import { z } from 'zod';

export type Role = 'admin' | 'staff';

export interface ApiKeyEntry {
  merchantId: string;
  role: Role;
  key: string;
}

const RawConfigSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  API_KEYS: z.string().default(''),
  RESERVATION_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(900),
  RESERVATION_SWEEP_INTERVAL_MS: z.coerce.number().int().min(1000).default(15_000),
  SEED_DEMO_DATA: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export interface AppConfig {
  port: number;
  nodeEnv: 'development' | 'test' | 'production';
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  rateLimitWindowMs: number;
  rateLimitMax: number;
  apiKeys: ApiKeyEntry[];
  /** How long checkout holds stock before an unpaid reservation expires. */
  reservationTtl: number;
  reservationSweepIntervalMs: number;
  seedDemoData: boolean;
}

export function parseApiKeys(raw: string): ApiKeyEntry[] {
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const [merchantId, role, key] = entry.split(':');
      if (!merchantId || !key || (role !== 'admin' && role !== 'staff')) {
        throw new Error(`Invalid API_KEYS entry for merchant "${merchantId ?? ''}"`);
      }
      return { merchantId, role, key };
    });
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const raw = RawConfigSchema.parse(env);
  const apiKeys = parseApiKeys(raw.API_KEYS);

  if (raw.NODE_ENV === 'production' && apiKeys.length === 0) {
    throw new Error('API_KEYS must be configured in production');
  }

  return {
    port: raw.PORT,
    nodeEnv: raw.NODE_ENV,
    logLevel: raw.LOG_LEVEL,
    rateLimitWindowMs: raw.RATE_LIMIT_WINDOW_MS,
    rateLimitMax: raw.RATE_LIMIT_MAX,
    apiKeys,
    reservationTtl: raw.RESERVATION_TTL_SECONDS,
    reservationSweepIntervalMs: raw.RESERVATION_SWEEP_INTERVAL_MS,
    seedDemoData: raw.SEED_DEMO_DATA,
  };
}
