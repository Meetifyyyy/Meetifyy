import type { RedisOptions } from 'bullmq';
import type { RedisConfig } from '../../config/redis.config';

/**
 * The connection every BullMQ queue and worker is built from.
 *
 * This is the WORKER shape: `maxRetriesPerRequest: null`, no command timeout.
 * A worker parks on a blocking read and must ride out a Redis outage, because
 * giving up would leave the process alive with its queues dead. BullMQ forces
 * `null` on every worker connection regardless.
 *
 * The producers (`Queue` instances) start from this same object and then
 * tighten it — see `producer-queue.ts`. They must NOT be tightened here: the
 * worker reads its connection from the same place, and a command timeout on a
 * blocking connection cancels the very read it is waiting on.
 */
export function buildBullConnection(
  redis: Pick<RedisConfig, 'url' | 'host' | 'port' | 'password' | 'tls'>,
): RedisOptions {
  if (redis.url) {
    const url = new URL(redis.url);
    return {
      host: url.hostname,
      port: parseInt(url.port, 10) || 6379,
      username: url.username || undefined,
      password: url.password || undefined,
      /**
       * TLS with the certificate actually verified.
       *
       * This passed `rejectUnauthorized: false`, which accepts any
       * certificate at all — including one presented by whoever is
       * between us and the cache. That is not a weaker TLS
       * configuration, it is TLS with the part that authenticates the
       * server switched off, and what travels over this connection is
       * session state and queue jobs.
       *
       * Verification is the Node default, so the option is simply gone.
       * `servername` is set explicitly rather than left to be inferred,
       * so SNI and the hostname the certificate is checked against are
       * the same value on every path into here.
       */
      tls:
        url.protocol === 'rediss:' ? { servername: url.hostname } : undefined,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      skipVersionCheck: true,
    };
  }

  return {
    host: redis.host,
    port: redis.port,
    password: redis.password,
    // Same reasoning as the URL branch above. This is the path taken
    // when the connection is configured as discrete host/port/password
    // rather than a single URL, and it had the same switch thrown.
    tls: redis.tls ? { servername: redis.host } : undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    skipVersionCheck: true,
  };
}
