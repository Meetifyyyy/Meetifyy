import { BullModule } from '@nestjs/bullmq';
import type { RegisterQueueOptions } from '@nestjs/bullmq';
import type { DynamicModule } from '@nestjs/common';
import { Queue, RedisConnection } from 'bullmq';
import type { ConnectionOptions, QueueOptions, RedisClient } from 'bullmq';
import {
  COMMAND_MAX_RETRIES_PER_REQUEST,
  COMMAND_TIMEOUT_MS,
  redisReconnectDelay,
} from '../../redis/redis.service';

/**
 * Producers fail fast; workers keep waiting.
 *
 * A `Queue` is what request handlers call `add` on (an OTP email, a push), so
 * during a Redis outage it must reject promptly and let the caller answer the
 * client. A `Worker` is the opposite: it parks on a blocking read and must
 * ride out the outage, or the process stays up with its queues dead. BullMQ
 * documents exactly this split; this file is where it is applied.
 *
 * Both are built from ONE options object (`buildBullConnection`), because
 * @nestjs/bullmq hands the Worker the connection recorded on its Queue. So the
 * Queue must not carry the tight options in `opts.connection`; instead it is
 * given a `Connection` class (a documented BullMQ constructor argument) that
 * tightens a copy of them for its own sockets only. The Worker keeps reading
 * the untouched object, and BullMQ forces `maxRetriesPerRequest: null` on its
 * connections anyway.
 */

/**
 * How long a producer waits for a connection that has never become ready
 * (Redis down at boot) before `add` rejects. Longer than the command timeout
 * because it also covers a healthy cold start, where the TLS handshake can be
 * late on a throttled container; once connected this never applies again.
 */
export const PRODUCER_READY_TIMEOUT_MS = 5_000;

export class QueueNotReadyError extends Error {
  constructor(waitedMs: number) {
    super(`Queue connection not ready after ${waitedMs} ms`);
    this.name = 'QueueNotReadyError';
  }
}

/**
 * True for the failures a producer reports when Redis cannot be reached in
 * time, as opposed to a job that is itself invalid: our own ready timeout, and
 * the two ioredis rejects the tightened options produce (a command that
 * outlived `commandTimeout`, and one dropped from the offline queue after
 * `maxRetriesPerRequest` failed reconnects). ioredis gives the first a plain
 * `Error` and the second a class it does not export, so both are matched by
 * what they say, which is stable across its 5.x releases.
 */
export function isQueueUnavailableError(err: unknown): boolean {
  if (err instanceof QueueNotReadyError) return true;
  if (!(err instanceof Error)) return false;
  return (
    err.name === 'MaxRetriesPerRequestError' ||
    err.message === 'Command timed out'
  );
}

/**
 * The producer's copy of the shared options: a command that cannot be sent
 * rejects instead of waiting for Redis. The same two limits, for the same
 * reasons, as the app's own command client (see `redisConnectionOptions`):
 * `commandTimeout` bounds one command, `maxRetriesPerRequest` empties the
 * offline queue after a few failed reconnects. Reconnection itself never
 * stops, and everything else (host, TLS verification, version-check skip)
 * is inherited unchanged.
 */
export function producerConnectionOptions(
  connection: ConnectionOptions,
): ConnectionOptions {
  // An already-built client belongs to whoever built it; none is passed here.
  if ('options' in connection) return connection;
  return {
    ...connection,
    maxRetriesPerRequest: COMMAND_MAX_RETRIES_PER_REQUEST,
    commandTimeout: COMMAND_TIMEOUT_MS,
    retryStrategy: (times: number) => redisReconnectDelay(times),
  };
}

/** `promise`, or a rejection after `ms`. The promise itself is left running. */
function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new QueueNotReadyError(ms)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

/**
 * Applies `producerConnectionOptions` to the sockets of one producer. The
 * connection's `client` promise is deliberately left alone: BullMQ's script
 * helper captures it once at construction and reuses it for every command, so
 * a bound placed on it would poison the queue for good after its first timeout.
 */
class ProducerConnection extends RedisConnection {
  constructor(
    opts: ConnectionOptions,
    extraOptions?: ConstructorParameters<typeof RedisConnection>[1],
  ) {
    super(producerConnectionOptions(opts), extraOptions);
  }
}

/** A `Queue` whose `add` rejects within a bound while Redis is unreachable. */
export class ProducerQueue extends Queue {
  constructor(name: string, opts?: QueueOptions) {
    super(name, opts, ProducerConnection);
  }

  /**
   * Every `add` awaits the connection before it sends anything. BullMQ
   * resolves that only once the socket is ready, and it never rejects while
   * ioredis keeps reconnecting, so with Redis down since boot a plain `add`
   * waits forever and `commandTimeout` never gets the chance to apply. Once
   * the socket has been ready this is an already-settled promise.
   *
   * The wait is abandoned, not the connection: when Redis returns the same
   * promise settles and later calls succeed.
   */
  private ready(): Promise<RedisClient> {
    return within(this.client, PRODUCER_READY_TIMEOUT_MS);
  }

  override async add(
    ...args: Parameters<Queue['add']>
  ): ReturnType<Queue['add']> {
    await this.ready();
    return super.add(...args);
  }

  override async addBulk(
    ...args: Parameters<Queue['addBulk']>
  ): ReturnType<Queue['addBulk']> {
    await this.ready();
    return super.addBulk(...args);
  }
}

/**
 * `BullModule.registerQueue` with `ProducerQueue` as the queue class.
 *
 * The class is read when `registerQueue` is called, so it is set immediately
 * before rather than once at startup, which would depend on module import
 * order. Workers are unaffected: they are created separately and read the
 * queue's recorded (patient) connection.
 */
export function registerProducerQueue(
  ...options: RegisterQueueOptions[]
): DynamicModule {
  BullModule.queueClass = ProducerQueue;
  return BullModule.registerQueue(...options);
}
