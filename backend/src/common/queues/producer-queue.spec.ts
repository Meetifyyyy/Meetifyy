import { getQueueToken } from '@nestjs/bullmq';
import type { FactoryProvider, Provider } from '@nestjs/common';
import { AbstractConnector } from 'ioredis';
import type { NetStream } from 'ioredis/built/types';
import type { QueueOptions, RedisOptions } from 'bullmq';
import { COMMAND_TIMEOUT_MS } from '../../redis/redis.service';
import { buildBullConnection } from './bull-connection';
import {
  PRODUCER_READY_TIMEOUT_MS,
  ProducerQueue,
  QueueNotReadyError,
  producerConnectionOptions,
  registerProducerQueue,
} from './producer-queue';

// Stands in for an unreachable Redis without opening a socket.
class BlackholeConnector extends AbstractConnector {
  constructor() {
    super(0);
  }
  connect(): Promise<NetStream> {
    return new Promise<NetStream>(() => undefined);
  }
}

const noRedis = {
  url: '',
  host: 'cache.internal',
  port: 6379,
  password: undefined,
  tls: false,
};

/** The shared options, pointed at a connector that never connects. */
function unreachable(): RedisOptions {
  return { ...buildBullConnection(noRedis), Connector: BlackholeConnector };
}

// `Queue.disconnect()` waits for the connection to become ready first, which a
// connection that never connects never does; closing the socket client is
// what stops its reconnect timers.
function hangUp(queue: ProducerQueue): void {
  queue['connection']['_client'].disconnect();
}

describe('buildBullConnection (what workers use)', () => {
  it.each([
    ['a URL', { ...noRedis, url: 'redis://:pw@cache.internal:6379' }],
    ['host and port', noRedis],
  ])('waits for Redis indefinitely when built from %s', (_label, redis) => {
    const connection = buildBullConnection(redis);
    expect(connection.maxRetriesPerRequest).toBeNull();
    expect(connection.commandTimeout).toBeUndefined();
    expect(connection.skipVersionCheck).toBe(true);
  });

  it('verifies the certificate for rediss and not otherwise', () => {
    const secure = buildBullConnection({
      ...noRedis,
      url: 'rediss://:pw@cache.internal:6380',
    });
    expect(secure.tls).toEqual({ servername: 'cache.internal' });
    expect(secure.port).toBe(6380);
    expect(buildBullConnection(noRedis).tls).toBeUndefined();
    expect(buildBullConnection({ ...noRedis, tls: true }).tls).toEqual({
      servername: 'cache.internal',
    });
  });
});

describe('producerConnectionOptions', () => {
  const shared = buildBullConnection({
    ...noRedis,
    url: 'rediss://user:pw@cache.internal:6380',
  });

  it('bounds the wait for a command', () => {
    const opts = producerConnectionOptions(shared) as RedisOptions;
    expect(opts.maxRetriesPerRequest).toBe(2);
    expect(opts.commandTimeout).toBe(COMMAND_TIMEOUT_MS);
    expect(COMMAND_TIMEOUT_MS).toBeLessThanOrEqual(2_000);
  });

  it('reconnects forever, with a capped delay', () => {
    const { retryStrategy } = producerConnectionOptions(shared) as RedisOptions;
    for (const attempt of [1, 6, 100, 1_000_000]) {
      const delay = retryStrategy?.(attempt);
      expect(typeof delay).toBe('number');
      expect(delay).toBeLessThanOrEqual(5_000 * 1.2);
    }
  });

  it('keeps everything else, including certificate verification', () => {
    const opts = producerConnectionOptions(shared) as RedisOptions;
    expect(opts).toMatchObject({
      host: 'cache.internal',
      port: 6380,
      username: 'user',
      password: 'pw',
      tls: { servername: 'cache.internal' },
      enableReadyCheck: false,
      skipVersionCheck: true,
    });
  });

  it('leaves the shared options, which workers read, untouched', () => {
    producerConnectionOptions(shared);
    expect(shared.maxRetriesPerRequest).toBeNull();
    expect(shared.commandTimeout).toBeUndefined();
    expect(shared.retryStrategy).toBeUndefined();
  });
});

describe('ProducerQueue with Redis unreachable', () => {
  const queues: ProducerQueue[] = [];
  const build = (
    connection: RedisOptions,
    opts: Partial<QueueOptions> = {},
  ): ProducerQueue => {
    const queue = new ProducerQueue('email', {
      connection,
      prefix: 'bull:test',
      ...opts,
    });
    queue.on('error', () => undefined);
    queues.push(queue);
    return queue;
  };

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    for (const queue of queues.splice(0)) hangUp(queue);
    jest.useRealTimers();
  });

  it('rejects add within the bound instead of waiting for Redis', async () => {
    const queue = build(unreachable());
    const outcome = queue.add('send-verification-otp', { otp: '123456' }).then(
      () => 'resolved' as const,
      (err: unknown) => err,
    );

    await jest.advanceTimersByTimeAsync(PRODUCER_READY_TIMEOUT_MS - 1);
    let settled = false;
    void outcome.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);

    await jest.advanceTimersByTimeAsync(2);
    await expect(outcome).resolves.toBeInstanceOf(QueueNotReadyError);
  });

  it('is not poisoned by a timeout: the next add waits its own full bound', async () => {
    const queue = build(unreachable());
    const attempt = () =>
      queue.add('send-verification-otp', {}).then(
        () => 'resolved' as const,
        (err: unknown) => err,
      );

    const first = attempt();
    await jest.advanceTimersByTimeAsync(PRODUCER_READY_TIMEOUT_MS + 1);
    await expect(first).resolves.toBeInstanceOf(QueueNotReadyError);

    // BullMQ reuses the connection promise captured at construction for every
    // command, so it must still be waiting, not rejected.
    let clientSettled = false;
    void queue.client.then(
      () => (clientSettled = true),
      () => (clientSettled = true),
    );
    await jest.advanceTimersByTimeAsync(60_000);
    expect(clientSettled).toBe(false);

    const second = attempt();
    let secondSettled = false;
    void second.then(() => (secondSettled = true));
    await jest.advanceTimersByTimeAsync(PRODUCER_READY_TIMEOUT_MS - 1);
    expect(secondSettled).toBe(false);
    await jest.advanceTimersByTimeAsync(2);
    await expect(second).resolves.toBeInstanceOf(QueueNotReadyError);
  });

  it('bounds addBulk the same way', async () => {
    const queue = build(unreachable());
    const outcome = queue.addBulk([{ name: 'n', data: {} }]).then(
      () => 'resolved' as const,
      (err: unknown) => err,
    );
    await jest.advanceTimersByTimeAsync(PRODUCER_READY_TIMEOUT_MS + 1);
    await expect(outcome).resolves.toBeInstanceOf(QueueNotReadyError);
  });

  it('builds its own sockets from the tightened options', () => {
    const queue = build(unreachable());
    const own = queue['connection']['_client'].options;
    expect(own.maxRetriesPerRequest).toBe(2);
    expect(own.commandTimeout).toBe(COMMAND_TIMEOUT_MS);
  });

  it('records the patient options for the worker to read', () => {
    const shared = unreachable();
    const queue = build(shared);
    // @nestjs/bullmq hands the Worker `queue.opts.connection`.
    expect(queue.opts.connection).toBe(shared);
    expect(shared.maxRetriesPerRequest).toBeNull();
    expect(shared.commandTimeout).toBeUndefined();
  });

  it('keeps the environment prefix and default job options', () => {
    const queue = build(unreachable(), {
      defaultJobOptions: { removeOnComplete: true },
    });
    expect(queue.opts.prefix).toBe('bull:test');
    expect(queue['jobsOpts']).toEqual({ removeOnComplete: true });
  });
});

describe('registerProducerQueue', () => {
  const isFactory = (provider: Provider): provider is FactoryProvider =>
    typeof provider === 'object' &&
    'provide' in provider &&
    'useFactory' in provider;

  it('registers a ProducerQueue under the usual queue token', async () => {
    const module = registerProducerQueue({ name: 'email' });
    const provider = (module.providers ?? [])
      .filter(isFactory)
      .find((p) => p.provide === getQueueToken('email'));
    expect(provider).toBeDefined();

    const queue: unknown = await provider?.useFactory({
      name: 'email',
      connection: unreachable(),
      prefix: 'bull:test',
    });
    expect(queue).toBeInstanceOf(ProducerQueue);
    if (queue instanceof ProducerQueue) {
      queue.on('error', () => undefined);
      hangUp(queue);
    }
  });
});
