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
  API_KEYS: z.string().default(''),
  SEED_DEMO_DATA: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  WEBHOOK_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  WEBHOOK_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(8),
  WEBHOOK_POLL_INTERVAL_MS: z.coerce.number().int().min(100).default(1_000),
});

export interface AppConfig {
  port: number;
  nodeEnv: 'development' | 'test' | 'production';
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  apiKeys: ApiKeyEntry[];
  seedDemoData: boolean;
  webhooks: {
    timeoutMs: number;
    maxAttempts: number;
    pollIntervalMs: number;
  };
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
    apiKeys,
    seedDemoData: raw.SEED_DEMO_DATA,
    webhooks: {
      timeoutMs: raw.WEBHOOK_TIMEOUT_MS,
      maxAttempts: raw.WEBHOOK_MAX_ATTEMPTS,
      pollIntervalMs: raw.WEBHOOK_POLL_INTERVAL_MS,
    },
  };
}
