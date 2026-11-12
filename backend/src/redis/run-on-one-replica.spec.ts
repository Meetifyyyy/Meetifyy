import { runOnOneReplica } from './run-on-one-replica';
import type { RedisService } from './redis.service';
import { stub } from '../common/testing/stub';
import { sharedLock } from './testing/shared-lock';

describe('runOnOneReplica', () => {
  it('runs the work when there is no Redis', async () => {
    const fn = jest.fn().mockResolvedValue('done');

    await expect(runOnOneReplica(undefined, 'k', 1000, fn)).resolves.toEqual({
      ran: true,
      value: 'done',
    });
  });

  it('runs on one of two concurrent replicas and skips the other', async () => {
    const lock = sharedLock();
    let release!: () => void;
    const fn = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );

    const first = runOnOneReplica(lock, 'k', 1000, fn);
    const second = await runOnOneReplica(lock, 'k', 1000, fn);
    release();

    expect(second).toEqual({ ran: false });
    expect(await first).toEqual({ ran: true, value: undefined });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('runs the work anyway when the lock cannot be taken', async () => {
    const redis = stub<RedisService>({
      runIfLockFree: jest.fn().mockRejectedValue(new Error('redis down')),
    });
    const fn = jest.fn().mockResolvedValue(7);

    await expect(runOnOneReplica(redis, 'k', 1000, fn)).resolves.toEqual({
      ran: true,
      value: 7,
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not run the work a second time when the work itself fails', async () => {
    const lock = sharedLock();
    const fn = jest.fn().mockRejectedValue(new Error('boom'));

    await expect(runOnOneReplica(lock, 'k', 1000, fn)).rejects.toThrow('boom');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
