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
