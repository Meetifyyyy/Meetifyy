import { APP_ENV, bool, int, str } from './env';

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

  /**
   * Key namespace for every BullMQ queue, so environments sharing one Redis
   * instance cannot consume each other's jobs.
   *
   * A local machine pointed at the deployed Redis used to register a worker on
   * the very same `bull:email` queue as production. Jobs go to whichever
   * worker polls first, so real production mail was being picked up by the
   * developer's worker and delivered into their local Mailpit — invisible to
   * production and never sent to the recipient. The same applied to the
   * notifications and instant-match queues.
   *
   * REDIS_QUEUE_PREFIX can override this where two deployments of the same
   * environment must stay separate (e.g. per-PR preview instances).
   */
  queuePrefix: str('REDIS_QUEUE_PREFIX', { default: `bull:${APP_ENV}` }),
};

export type RedisConfig = typeof redisConfigValues;
