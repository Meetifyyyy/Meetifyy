import {
  PrivateMediaJanitor,
  shouldRunPrivateMediaRelocation,
} from './private-media-janitor';
import type { CloudflareR2Provider } from './providers/cloudflare-r2.provider';
import type { PrivateMediaTarget } from './private-media-relocation';
import type { RedisService } from '../redis/redis.service';
import { stub } from '../common/testing/stub';
import { FakeR2 } from './testing/fake-r2';

type Lock = <T>(
  key: string,
  ttl: number,
  fn: () => Promise<T>,
) => Promise<{ ran: true; value: T } | { ran: false }>;

describe('PrivateMediaJanitor', () => {
  const build = (opts: {
    target?: PrivateMediaTarget | null;
    free?: boolean;
  }) => {
    const r2 = new FakeR2();
    r2.put('main', 'chat/a.webp', 'bytes');
    const target =
      opts.target === undefined
        ? { s3: r2.client(), mainBucket: 'main', privateBucket: 'private' }
        : opts.target;

    const getRelocationTarget = jest.fn(() => target);
    const forgetReadBucket = jest.fn<void, [string]>();
    const runIfLockFree = jest.fn<ReturnType<Lock>, Parameters<Lock>>(
      async (_key, _ttl, fn) =>
        opts.free === false ? { ran: false } : { ran: true, value: await fn() },
    );
    const janitor = new PrivateMediaJanitor(
      stub<CloudflareR2Provider>({ getRelocationTarget, forgetReadBucket }),
      stub<RedisService>({
        runIfLockFree: runIfLockFree as RedisService['runIfLockFree'],
      }),
    );
    const warn = jest
      .spyOn(janitor['logger'], 'warn')
      .mockImplementation(() => undefined);
    const log = jest
      .spyOn(janitor['logger'], 'log')
      .mockImplementation(() => undefined);
    return { janitor, r2, runIfLockFree, forgetReadBucket, warn, log };
  };

  it('moves the backlog under a lock and drops each moved key from the read cache', async () => {
    const { janitor, r2, runIfLockFree, forgetReadBucket } = build({});

    await janitor.run();

    expect(runIfLockFree).toHaveBeenCalledWith(
      'private-media-relocation',
      30 * 60 * 1000,
      expect.any(Function),
    );
    expect(r2.has('private', 'chat/a.webp')).toBe(true);
    expect(r2.has('main', 'chat/a.webp')).toBe(false);
    expect(forgetReadBucket).toHaveBeenCalledWith('chat/a.webp');
  });

  it('does no storage work when another replica holds the lock', async () => {
    const { janitor, r2, log, warn } = build({ free: false });

    await janitor.run();

    expect(r2.send).not.toHaveBeenCalled();
    expect(r2.has('main', 'chat/a.webp')).toBe(true);
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('does not even ask for the lock when there is no private bucket to move to', async () => {
    const { janitor, runIfLockFree } = build({ target: null });
    await janitor.run();
    expect(runIfLockFree).not.toHaveBeenCalled();
  });

  it('swallows a lock failure instead of failing boot', async () => {
    const { janitor, runIfLockFree, warn } = build({});
    runIfLockFree.mockRejectedValueOnce(new Error('redis down'));

    await expect(janitor.run()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('redis down'));
  });

  it('swallows a storage failure and reports it as a count', async () => {
    const { janitor, r2, warn } = build({});
    r2.send.mockRejectedValue(
      Object.assign(new Error('denied'), { name: 'AccessDenied' }),
    );

    await expect(janitor.run()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('"failed":');
  });

  it('logs counts only, never a key', async () => {
    const { janitor, log, warn } = build({});

    await janitor.run();

    const lines = [...log.mock.calls, ...warn.mock.calls].map(String);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"copied":1');
    expect(lines[0]).not.toContain('a.webp');
  });

  it('stays quiet when there is nothing to move', async () => {
    const { janitor, r2, log } = build({});
    r2.buckets.get('main')?.clear();

    await janitor.run();

    expect(log).not.toHaveBeenCalled();
  });

  it('does not make boot wait for the pass', () => {
    const { janitor, runIfLockFree } = build({});
    runIfLockFree.mockReturnValue(new Promise(() => undefined));

    expect(janitor.onApplicationBootstrap()).toBeUndefined();
    expect(runIfLockFree).toHaveBeenCalledTimes(1);
  });
});

describe('shouldRunPrivateMediaRelocation', () => {
  const settings = (
    over: Partial<{
      isTest: boolean;
      provider: string;
      bucketName: string;
      verificationBucketName: string;
    }> = {},
  ) => {
    const o = {
      isTest: false,
      provider: 'r2',
      bucketName: 'main',
      verificationBucketName: 'private',
      ...over,
    };
    return {
      isTest: o.isTest,
      storage: {
        provider: o.provider,
        r2: {
          bucketName: o.bucketName,
          verificationBucketName: o.verificationBucketName,
        },
      },
    };
  };

  it('registers for R2 with a distinct private bucket', () => {
    expect(shouldRunPrivateMediaRelocation(settings())).toBe(true);
  });

  it.each([
    ['under test', { isTest: true }],
    ['with the same bucket for both', { verificationBucketName: 'main' }],
    ['with no private bucket', { verificationBucketName: '' }],
    ['for a provider other than R2', { provider: 'local' }],
  ])('does not register %s', (_label, over) => {
    expect(shouldRunPrivateMediaRelocation(settings(over))).toBe(false);
  });
});
