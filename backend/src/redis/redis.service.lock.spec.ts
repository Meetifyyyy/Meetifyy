import type { Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import type { ConfigService } from '@nestjs/config';
import { RedisService } from './redis.service';
import { stub } from '../common/testing/stub';

describe('RedisService.withLock', () => {
  const build = (client: Redis | null = null) => {
    const service = new RedisService(stub<ConfigService>());
    service['client'] = client;
    return service;
  };

  it('does not leak in-process lock entries', async () => {
    const service = build();
    await Promise.all(
      ['a', 'b', 'a', 'c', 'a'].map((k) =>
        service.withLock(k, 1000, () => Promise.resolve(k)),
      ),
    );
    await service.withLock('z', 1000, () => Promise.resolve());
    expect(service['inProcessLocks'].size).toBe(0);
  });

  it('still serialises callers for the same key', async () => {
    const service = build();
    const order: string[] = [];
    const run = (name: string, ms: number) =>
      service.withLock('k', 1000, async () => {
        order.push(`${name}:start`);
        await new Promise((r) => setTimeout(r, ms));
        order.push(`${name}:end`);
      });
    await Promise.all([run('1', 30), run('2', 1), run('3', 1)]);
    expect(order).toEqual([
      '1:start',
      '1:end',
      '2:start',
      '2:end',
      '3:start',
      '3:end',
    ]);
  });

  it('releases the redis lock atomically with the value it acquired', async () => {
    const set = jest.fn().mockResolvedValue('OK');
    const evalFn = jest.fn().mockResolvedValue(1);
    const get = jest.fn();
    const del = jest.fn();
    const service = build(stub<Redis>({ set, eval: evalFn, get, del }));

    await service.withLock('room:1', 1000, () => Promise.resolve());

    const setCall = set.mock.calls[0] as [string, string];
    const lockVal = setCall[1];
    expect(evalFn).toHaveBeenCalledTimes(1);
    const [script, numKeys, lockKey, arg] = evalFn.mock.calls[0] as [
      string,
      number,
      string,
      string,
    ];
    expect(script).toMatch(/get.*==.*ARGV\[1\].*del/);
    expect([numKeys, lockKey, arg]).toEqual([1, 'lock:room:1', lockVal]);
    // No racy GET-then-DEL.
    expect(get).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });
});

describe('RedisService.runIfLockFree', () => {
  // Built without the constructor, which would open real connections to
  // whatever REDIS_URL names; only the client field is read here.
  const build = (client: Redis | null) => {
    const service = Object.create(RedisService.prototype) as RedisService;
    service['client'] = client;
    return service;
  };

  it('runs when it wins the lock and releases it with its own value', async () => {
    const set = jest.fn().mockResolvedValue('OK');
    const evalFn = jest.fn().mockResolvedValue(1);
    const service = build(stub<Redis>({ set, eval: evalFn }));

    const result = await service.runIfLockFree('job', 5000, () =>
      Promise.resolve('done'),
    );

    expect(result).toEqual({ ran: true, value: 'done' });
    const setCall = set.mock.calls[0] as unknown[];
    expect(setCall.slice(0, 1)).toEqual(['lock:job']);
    expect(setCall.slice(2)).toEqual(['PX', 5000, 'NX']);
    const evalCall = evalFn.mock.calls[0] as unknown[];
    expect(evalCall[3]).toBe(setCall[1]);
  });

  it('does not run, and does not wait, when the lock is held', async () => {
    const set = jest.fn().mockResolvedValue(null);
    const evalFn = jest.fn();
    const fn = jest.fn(() => Promise.resolve('x'));
    const service = build(stub<Redis>({ set, eval: evalFn }));

    const result = await service.runIfLockFree('job', 5000, fn);

    expect(result).toEqual({ ran: false });
    expect(fn).not.toHaveBeenCalled();
    // One attempt only: withLock would have retried for ttl/2.
    expect(set).toHaveBeenCalledTimes(1);
    expect(evalFn).not.toHaveBeenCalled();
  });

  it('releases the lock when the work throws', async () => {
    const set = jest.fn().mockResolvedValue('OK');
    const evalFn = jest.fn().mockResolvedValue(1);
    const service = build(stub<Redis>({ set, eval: evalFn }));

    await expect(
      service.runIfLockFree('job', 5000, () => Promise.reject(new Error('x'))),
    ).rejects.toThrow('x');
    expect(evalFn).toHaveBeenCalledTimes(1);
  });

  it('runs without a lock when there is no Redis', async () => {
    const result = await build(null).runIfLockFree('job', 5000, () =>
      Promise.resolve(1),
    );
    expect(result).toEqual({ ran: true, value: 1 });
  });
});

describe('RedisService.withLock while Redis is unreachable', () => {
  const build = (client: Redis) => {
    const service = Object.create(RedisService.prototype) as RedisService;
    service['client'] = client;
    // Field initialisers do not run without the constructor.
    Object.defineProperty(service, 'inProcessLocks', { value: new Map() });
    Object.defineProperty(service, 'logger', {
      value: stub<Logger>({ debug: jest.fn() }),
    });
    return service;
  };

  it('runs the work without the distributed lock when acquiring fails', async () => {
    const set = jest.fn().mockRejectedValue(new Error('Command timed out'));
    const evalFn = jest.fn();
    const service = build(stub<Redis>({ set, eval: evalFn }));

    await expect(
      service.withLock('k', 1000, () => Promise.resolve('ran')),
    ).resolves.toBe('ran');
    expect(set).toHaveBeenCalledTimes(1);
    expect(evalFn).not.toHaveBeenCalled();
  });

  it('still raises an error thrown by the work itself', async () => {
    const set = jest.fn().mockResolvedValue('OK');
    const evalFn = jest.fn().mockResolvedValue(1);
    const service = build(stub<Redis>({ set, eval: evalFn }));

    await expect(
      service.withLock('k', 1000, () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
  });
});
