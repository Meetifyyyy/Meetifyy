import Redis, { AbstractConnector } from 'ioredis';
import type { NetStream } from 'ioredis/built/types';
import {
  COMMAND_TIMEOUT_MS,
  redisConnectionOptions,
  redisReconnectDelay,
} from './redis.service';

describe('redisReconnectDelay', () => {
  const middle = () => 0.5; // zero jitter

  it('never gives up, however many attempts have failed', () => {
    for (const attempt of [
      1,
      6,
      7,
      50,
      1_000,
      1_000_000,
      Number.MAX_SAFE_INTEGER,
    ]) {
      const delay = redisReconnectDelay(attempt);
      expect(typeof delay).toBe('number');
      expect(Number.isFinite(delay)).toBe(true);
      expect(delay).toBeGreaterThan(0);
    }
  });

  it('doubles from 200 ms up to a 5 s ceiling', () => {
    const delays = [1, 2, 3, 4, 5, 6, 7, 20].map((n) =>
      redisReconnectDelay(n, middle),
    );
    expect(delays).toEqual([200, 400, 800, 1600, 3200, 5000, 5000, 5000]);
  });

  it('keeps every delay within 20 % of the capped value', () => {
    for (let attempt = 1; attempt <= 12; attempt++) {
      const nominal = Math.min(200 * 2 ** (attempt - 1), 5000);
      const lowest = redisReconnectDelay(attempt, () => 0);
      const highest = redisReconnectDelay(attempt, () => 1);
      expect(lowest).toBe(Math.round(nominal * 0.8));
      expect(highest).toBe(Math.round(nominal * 1.2));
    }
  });

  it('actually varies between callers', () => {
    const seen = new Set(
      Array.from({ length: 50 }, () => redisReconnectDelay(6)),
    );
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('redisConnectionOptions', () => {
  const plain = new URL('redis://:pw@cache.internal:6379');
  const secure = new URL('rediss://:pw@cache.internal:6380');

  it('gives the command client a bounded wait', () => {
    const opts = redisConnectionOptions(plain, 'command');
    expect(opts.maxRetriesPerRequest).toBe(2);
    expect(opts.commandTimeout).toBe(COMMAND_TIMEOUT_MS);
    expect(COMMAND_TIMEOUT_MS).toBeLessThanOrEqual(2_000);
    // Commands queue while reconnecting rather than failing at once, so a
    // sub-second blip does not drop them.
    expect(opts.enableOfflineQueue).toBeUndefined();
  });

  it('lets the subscriber wait for Redis and re-join its channels', () => {
    const opts = redisConnectionOptions(plain, 'subscriber');
    expect(opts.maxRetriesPerRequest).toBeNull();
    expect(opts.commandTimeout).toBeUndefined();
    expect(opts.autoResubscribe).toBe(true);
  });

  it.each(['command', 'subscriber'] as const)(
    'reconnects forever on the %s connection',
    (role) => {
      const { retryStrategy } = redisConnectionOptions(plain, role);
      expect(retryStrategy).toBeInstanceOf(Function);
      for (const attempt of [1, 6, 100, 100_000]) {
        expect(typeof retryStrategy?.(attempt)).toBe('number');
      }
    },
  );

  it('still refuses to reconnect into a connection-limit error', () => {
    const { reconnectOnError } = redisConnectionOptions(plain, 'command');
    expect(
      reconnectOnError?.(new Error('ERR max number of clients reached')),
    ).toBe(false);
    expect(reconnectOnError?.(new Error('READONLY You can'))).toBe(true);
  });

  it('verifies the certificate for rediss and not otherwise', () => {
    expect(redisConnectionOptions(secure, 'command').tls).toEqual({
      servername: 'cache.internal',
    });
    expect(redisConnectionOptions(plain, 'command').tls).toBeUndefined();
  });
});

describe('a real ioredis client built from these options, with Redis unreachable', () => {
  // A connector that never connects stands in for an unreachable server
  // without opening a socket.
  class BlackholeConnector extends AbstractConnector {
    constructor() {
      super(0);
    }
    connect(): Promise<NetStream> {
      return new Promise<NetStream>(() => undefined);
    }
  }

  const clients: Redis[] = [];
  const build = (role: 'command' | 'subscriber') => {
    const client = new Redis({
      ...redisConnectionOptions(new URL('redis://cache.internal:6379'), role),
      Connector: BlackholeConnector,
    });
    client.on('error', () => undefined);
    clients.push(client);
    return client;
  };

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    for (const client of clients.splice(0)) client.disconnect();
    jest.useRealTimers();
  });

  it('rejects a command within the command timeout instead of waiting', async () => {
    const client = build('command');
    const outcome = client.get('k').then(
      () => 'resolved',
      (err: unknown) => (err instanceof Error ? err.message : 'other'),
    );

    await jest.advanceTimersByTimeAsync(COMMAND_TIMEOUT_MS - 1);
    let settled = false;
    void outcome.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);

    await jest.advanceTimersByTimeAsync(2);
    await expect(outcome).resolves.toBe('Command timed out');
  });

  it('leaves a subscribe waiting for Redis rather than rejecting it', async () => {
    const client = build('subscriber');
    let settled = false;
    void client.subscribe('chan').then(
      () => (settled = true),
      () => (settled = true),
    );

    await jest.advanceTimersByTimeAsync(10 * 60_000);
    expect(settled).toBe(false);
  });
});
