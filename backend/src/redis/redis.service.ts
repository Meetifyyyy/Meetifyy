import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

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
    const redisUrl = this.configService.get<string>('REDIS_URL');

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
            if (times > 5) return 2000;
            return Math.min(times * 200, 1000);
          },
        };

        this.client = new Redis(redisUrl, options);
        this.subClient = new Redis(redisUrl, options);

        this.client.on('connect', () => this.logger.log('Shared Redis connection established'));
        this.subClient.on('connect', () => this.logger.log('Redis Subscriber connection established'));

        this.client.on('error', (err) => this.logger.warn(`Shared Redis issue: ${err.message || err}`));
        this.subClient.on('error', (err) => this.logger.warn(`Redis Subscriber issue: ${err.message || err}`));
      } catch (e) {
        this.logger.error('Failed to parse REDIS_URL', e);
      }
    } else {
      this.logger.warn('REDIS_URL not configured. RedisService will not be available.');
    }
  }

  getClient(): Redis | null { return this.client; }
  getPubClient(): Redis | null { return this.client; }
  getSubClient(): Redis | null { return this.subClient; }

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
  async withLock<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
    return this.withInProcessLock(key, () => this.withRedisLock(key, ttlMs, fn));
  }

  private withInProcessLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const tail = this.inProcessLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const slot = new Promise<void>((resolve) => { release = resolve; });
    // Chain this request behind the current tail
    this.inProcessLocks.set(key, tail.then(() => slot));

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

  private async withRedisLock<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
    if (!this.client) return fn();

    const lockKey = `lock:${key}`;
    const lockVal = Math.random().toString(36).substring(2);

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
      await new Promise(r => setTimeout(r, step));
      waited += step;
    }

    if (!acquired) {
      // Fall through to running the function without distributed exclusion
      // (in-process lock still serializes within this instance).
      this.logger.warn(`Redis lock contended for key=${key}, proceeding without distributed lock`);
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
