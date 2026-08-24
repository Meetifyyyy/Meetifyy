import { bool, int, str } from './env';

/**
 * Redis / BullMQ connection configuration.
 *
 * REDIS_URL is the single-value form used by every managed provider. The
 * discrete host/port fields remain for setups that expose them separately.
 */
export const redisConfigValues = {
  url: str('REDIS_URL'),
  host: str('REDIS_HOST', { default: '127.0.0.1' }),
  port: int('REDIS_PORT', { default: '6379', min: 1, max: 65535 }),
  password: str('REDIS_PASSWORD') || undefined,
  tls: bool('REDIS_TLS'),
};

export type RedisConfig = typeof redisConfigValues;
