import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { config } from '../config';
import { randomBytes } from 'crypto';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private subClient: Redis | null = null;

  /**
   * In-process mutex map: always-on sequential queue for a single Node.js instance.
   * Maps a lock key to a Promise chain — requests for the same key queue up and
   * execute one-at-a-time even when Redis is unavailable.
   */
  private readonly inProcessLocks = new Map<string, Promise<void>>();

  constructor(private readonly configService: ConfigService) {
    const redisUrl = config.redis.url;

    if (redisUrl) {
      try {
        const url = new URL(redisUrl);
        const isTls = url.protocol === 'rediss:';

        const options = {
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
          keepAlive: 10000,
          noDelay: true,
          family: 4,
          connectTimeout: 5000,
          tls: isTls ? { rejectUnauthorized: false } : undefined,
          retryStrategy(times: number) {
            if (times > 5) return null;
            return Math.min(times * 1000, 5000);
          },
          reconnectOnError(err: Error) {
            if (
              err.message &&
              err.message.includes('max number of clients reached')
            ) {
              return false;
            }
            return true;
          },
        };

        this.client = new Redis(redisUrl, options);
        this.subClient = new Redis(redisUrl, options);

        this.client.on('connect', () =>
          this.logger.log('Shared Redis connection established'),
        );
        this.subClient.on('connect', () =>
          this.logger.log('Redis Subscriber connection established'),
        );

        const handleRedisError = (label: string) => {
          let hasWarnedMaxClients = false;
          return (err: any) => {
            const msg = err?.message || String(err);
            if (msg.includes('max number of clients reached')) {
              if (!hasWarnedMaxClients) {
                hasWarnedMaxClients = true;
                this.logger.warn(
                  `${label}: Cloud connection limit reached. Using in-memory fallback.`,
                );
              }
              return;
            }
            this.logger.warn(`${label}: ${msg}`);
          };
        };

        this.client.on('error', handleRedisError('Shared Redis'));
        this.subClient.on('error', handleRedisError('Redis Subscriber'));
      } catch (e) {
        this.logger.error('Failed to parse REDIS_URL', e);
      }
    } else {
      this.logger.warn(
        'REDIS_URL not configured. RedisService will not be available.',
      );
    }
  }

  getClient(): Redis | null {
    return this.client;
  }
  getPubClient(): Redis | null {
    return this.client;
  }
  getSubClient(): Redis | null {
    return this.subClient;
  }

  /**
   * Dual-layer distributed mutex:
   *
   * Layer 1 — In-process promise chain (always-on):
   *   Guarantees sequential execution within a single Node.js process regardless
   *   of Redis availability. Concurrent requests for the same key queue up and
   *   run one-at-a-time.
   *
   * Layer 2 — Redis SET NX PX (multi-instance):
   *   When Redis is available, adds cross-instance serialization so requests from
   *   multiple backend replicas are also serialized.
   */
  async withLock<T>(
    key: string,
    ttlMs: number,
    fn: () => Promise<T>,
  ): Promise<T> {
    return this.withInProcessLock(key, () =>
      this.withRedisLock(key, ttlMs, fn),
    );
  }

  private withInProcessLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const tail = this.inProcessLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const slot = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Chain this request behind the current tail
    this.inProcessLocks.set(
      key,
      tail.then(() => slot),
    );

    return tail.then(async () => {
      try {
        return await fn();
      } finally {
        release();
        // Prune stale map entry when no waiters remain
        if (this.inProcessLocks.get(key) === tail.then(() => slot)) {
          this.inProcessLocks.delete(key);
        }
      }
    });
  }

  private async withRedisLock<T>(
    key: string,
    ttlMs: number,
    fn: () => Promise<T>,
  ): Promise<T> {
    if (!this.client) return fn();

    const lockKey = `lock:${key}`;
    // The lock value is the proof of ownership: release only deletes the key if
    // the stored value still matches, so a holder cannot drop a lock that has
    // since been taken by someone else. `Math.random` is predictable enough that
    // another process could forge a matching value and release a lock it never
    // held, so this uses the CSPRNG.
    const lockVal = randomBytes(16).toString('hex');

    // Retry acquiring the lock for up to ttlMs/2, with 50ms backoff steps.
    const maxWait = Math.floor(ttlMs / 2);
    const step = 50;
    let waited = 0;
    let acquired = false;

    while (waited <= maxWait) {
      const res = await this.client.set(lockKey, lockVal, 'PX', ttlMs, 'NX');
      if (res === 'OK') {
        acquired = true;
        break;
      }
      await new Promise((r) => setTimeout(r, step));
      waited += step;
    }

    if (!acquired) {
      // Fall through to running the function without distributed exclusion
      // (in-process lock still serializes within this instance).
      this.logger.warn(
        `Redis lock contended for key=${key}, proceeding without distributed lock`,
      );
      return fn();
    }

    try {
      return await fn();
    } finally {
      try {
        const currentVal = await this.client.get(lockKey);
        if (currentVal === lockVal) await this.client.del(lockKey);
      } catch {
        // Ignore release errors
      }
    }
  }

  async onModuleDestroy() {
    if (this.client) await this.client.quit();
    if (this.subClient) await this.subClient.quit();
  }
}
