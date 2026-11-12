import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { RedisOptions } from 'ioredis';
import { config } from '../config';
import { randomBytes } from 'crypto';
import { errorMessage } from '../common/utils/error.util';

/** Deletes the lock only if it still holds the caller's value. */
const RELEASE_LOCK_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

const RECONNECT_BASE_MS = 200;
const RECONNECT_CAP_MS = 5_000;
const RECONNECT_JITTER = 0.2;

/** At most one warning per connection per minute while Redis stays down. */
const ERROR_LOG_INTERVAL_MS = 60_000;

/**
 * How long ioredis waits before reconnect attempt `attempt` (1-based).
 *
 * Exponential from 200 ms to a 5 s ceiling, with +/-20 % jitter so the
 * replicas and the two connections of each do not all return to a restarted
 * Redis in the same instant. It always returns a number: ioredis stops
 * reconnecting for good when the strategy returns anything else, and a process
 * that has stopped reconnecting keeps serving requests with rate limiting,
 * locks, caches, presence and the cross-replica socket relay all dead until
 * someone restarts it. A cache that is down for a minute must be back a few
 * seconds after it returns, so there is no attempt limit.
 *
 * `random` exists for tests; the jitter is not security-sensitive.
 */
export function redisReconnectDelay(
  attempt: number,
  random: () => number = Math.random,
): number {
  const exponent = Math.min(Math.max(attempt - 1, 0), 30);
  const ceiling = Math.min(RECONNECT_BASE_MS * 2 ** exponent, RECONNECT_CAP_MS);
  const jitter = 1 + (random() * 2 - 1) * RECONNECT_JITTER;
  return Math.round(ceiling * jitter);
}

/** How long a command may take before its caller gives up on it. */
export const COMMAND_TIMEOUT_MS = 2_000;

/**
 * Options for one of the two connections. They differ only in how long a
 * command may wait, because the two connections are used in opposite ways:
 *
 * `command` serves request paths (rate limiting, locks, caches, presence).
 * While Redis is unreachable a command must fail within a bounded time so the
 * caller reaches its own fallback, instead of holding a request open until
 * Redis returns. Two limits, because neither is enough alone:
 *   - `commandTimeout` bounds the wait for any one command. A sub-second
 *     blip is still ridden out: commands queue while ioredis reconnects and
 *     are sent on the first attempt that succeeds, well inside the timeout.
 *     It cannot be the only limit because a timed-out command stays in
 *     ioredis' offline queue (and is still sent on reconnect).
 *   - `maxRetriesPerRequest` makes ioredis reject and empty that queue every
 *     third failed reconnect, so a long outage does not pile up commands whose
 *     callers left long ago.
 * Nothing on this connection blocks server-side (no BLPOP, XREAD or
 * SUBSCRIBE), so a command timeout cannot cut a legitimate wait short.
 *
 * `subscriber` holds channel subscriptions. A subscribe issued while Redis is
 * down must still take effect once it returns, so commands wait in the queue
 * without limit and there is no command timeout; a rejected SUBSCRIBE would be
 * a channel never joined, and ioredis only re-joins channels it had joined.
 * `autoResubscribe` (on by default, stated here because it is load-bearing)
 * re-joins every channel after a reconnect.
 */
export function redisConnectionOptions(
  url: URL,
  role: 'command' | 'subscriber',
): RedisOptions {
  const isTls = url.protocol === 'rediss:';
  return {
    ...(role === 'command'
      ? { maxRetriesPerRequest: 2, commandTimeout: COMMAND_TIMEOUT_MS }
      : { maxRetriesPerRequest: null, autoResubscribe: true }),
    enableReadyCheck: false,
    keepAlive: 10000,
    noDelay: true,
    family: 4,
    connectTimeout: 5000,
    // Verified, not merely encrypted. `rejectUnauthorized: false` here
    // accepted any certificate, so anything able to sit between this
    // process and the cache could read and rewrite what crosses it —
    // sessions, presence and rate-limit counters. Verification is Node's
    // default; `servername` pins the name the certificate is checked
    // against to the host we meant to reach. See app.module.ts for the
    // matching queue connection.
    tls: isTls ? { servername: url.hostname } : undefined,
    retryStrategy: (times: number) => redisReconnectDelay(times),
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
}

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private subClient: Redis | null = null;

  /**
   * Redis sits behind Container Apps' internal TCP ingress, which closes a
   * connection that carries no data for about five minutes. TCP keepalive does
   * not count — the proxy terminates TCP — so an idle connection was cut and
   * re-established every five minutes, all day (logs: ~12 "connection
   * established" per hour per connection). Each cut lost the domain events,
   * relayed socket emits and cache invalidations published while the
   * subscriber was reconnecting, and made ioredis re-send in-flight commands.
   * A PING a minute is real traffic, so the connection never goes idle.
   */
  private static readonly HEARTBEAT_MS = 60_000;
  private heartbeatTimer: NodeJS.Timeout | null = null;

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

        this.client = new Redis(
          redisUrl,
          redisConnectionOptions(url, 'command'),
        );
        this.subClient = new Redis(
          redisUrl,
          redisConnectionOptions(url, 'subscriber'),
        );

        this.client.on('connect', () =>
          this.logger.log('Shared Redis connection established'),
        );
        this.subClient.on('connect', () =>
          this.logger.log('Redis Subscriber connection established'),
        );

        const handleRedisError = (label: string) => {
          let hasWarnedMaxClients = false;
          // ioredis emits one error per failed reconnect attempt, which is
          // several a minute for as long as Redis is down. The first is
          // logged at once; after that, one a minute with a count of what
          // was left out.
          let lastLoggedAt = 0;
          let suppressed = 0;
          return (err: Error) => {
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
            const now = Date.now();
            if (lastLoggedAt && now - lastLoggedAt < ERROR_LOG_INTERVAL_MS) {
              suppressed += 1;
              return;
            }
            lastLoggedAt = now;
            const repeats = suppressed
              ? ` (${suppressed} similar errors in the last minute)`
              : '';
            suppressed = 0;
            this.logger.warn(`${label}: ${msg}${repeats}`);
          };
        };

        this.client.on('error', handleRedisError('Shared Redis'));
        this.subClient.on('error', handleRedisError('Redis Subscriber'));

        this.heartbeatTimer = setInterval(
          () => this.pingIdleConnections(),
          RedisService.HEARTBEAT_MS,
        );
        // Never hold the process open on this timer alone.
        this.heartbeatTimer.unref();
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

  /**
   * Runs `fn` only if no other process holds `key`; otherwise returns at once
   * without running it.
   *
   * `withLock` waits and then runs anyway when the lock stays contended, which
   * is right for protecting a critical section and wrong for work that should
   * happen ONCE across replicas: a second replica must skip it, not repeat it.
   * With no Redis configured there is only one process, so `fn` runs.
   *
   * The lock expires after `ttlMs` if its holder dies; it is released as soon
   * as `fn` settles.
   */
  async runIfLockFree<T>(
    key: string,
    ttlMs: number,
    fn: () => Promise<T>,
  ): Promise<{ ran: true; value: T } | { ran: false }> {
    if (!this.client) return { ran: true, value: await fn() };

    const lockKey = `lock:${key}`;
    const lockVal = randomBytes(16).toString('hex');
    const res = await this.client.set(lockKey, lockVal, 'PX', ttlMs, 'NX');
    if (res !== 'OK') return { ran: false };

    try {
      return { ran: true, value: await fn() };
    } finally {
      try {
        await this.client.eval(RELEASE_LOCK_SCRIPT, 1, lockKey, lockVal);
      } catch {
        // Expires on its own after ttlMs.
      }
    }
  }

  private withInProcessLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const tail = this.inProcessLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const slot = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Chain this request behind the current tail. The promise is kept in a
    // variable because the prune below compares against it by identity — a
    // fresh `tail.then(...)` is a different object every time, so the entry
    // was never recognised as its own and every key leaked.
    const nextTail = tail.then(() => slot);
    this.inProcessLocks.set(key, nextTail);

    return tail.then(async () => {
      try {
        return await fn();
      } finally {
        release();
        // Prune stale map entry when no waiters remain
        if (this.inProcessLocks.get(key) === nextTail) {
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
      let res: 'OK' | null;
      try {
        res = await this.client.set(lockKey, lockVal, 'PX', ttlMs, 'NX');
      } catch (err: unknown) {
        // Redis is unreachable (commands now fail within seconds rather than
        // waiting for it). This is the same position as a contended lock that
        // never frees: run without cross-instance exclusion, still serialised
        // within this process by the in-process lock, instead of failing a
        // request that did not need Redis to succeed. Logged at debug: the
        // connection's own throttled warning already reports the outage, and
        // this runs once per request.
        this.logger.debug(
          `Redis lock unavailable for key=${key} (${errorMessage(err)}), proceeding without distributed lock`,
        );
        return fn();
      }
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
        // Compare-and-delete in one atomic step. GET-then-DEL left a window in
        // which the lock could expire and be taken by another holder between
        // the two calls, and this would then delete THEIR lock.
        await this.client.eval(RELEASE_LOCK_SCRIPT, 1, lockKey, lockVal);
      } catch {
        // Ignore release errors
      }
    }
  }

  /**
   * One PING per ready connection. PING is valid in subscriber mode, so the
   * subscriber connection is kept alive the same way.
   */
  private pingIdleConnections(): void {
    for (const conn of [this.client, this.subClient]) {
      if (conn?.status !== 'ready') continue;
      // Fire-and-forget: a failed ping means the connection is already
      // dropping, which ioredis reports and recovers from on its own.
      conn.ping().catch(() => undefined);
    }
  }

  async onModuleDestroy() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.client) await this.client.quit();
    if (this.subClient) await this.subClient.quit();
  }
}
