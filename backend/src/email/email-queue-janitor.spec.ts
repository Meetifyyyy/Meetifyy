import { EmailQueueJanitor } from './email-queue-janitor';
import { stub } from '../common/testing/stub';
import type { Queue } from 'bullmq';

type Status = 'completed' | 'failed';
type Clean = (grace: number, limit: number, type?: Status) => Promise<string[]>;

const ids = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => `${i}`);

describe('EmailQueueJanitor', () => {
  function build(clean: jest.Mock<ReturnType<Clean>, Parameters<Clean>>) {
    const janitor = new EmailQueueJanitor(stub<Queue>({ clean }));
    const warn = jest
      .spyOn(janitor['logger'], 'warn')
      .mockImplementation(() => undefined);
    const log = jest
      .spyOn(janitor['logger'], 'log')
      .mockImplementation(() => undefined);
    return { janitor, warn, log };
  }

  it('cleans completed jobs at once, then failed ones older than a day', async () => {
    const clean = jest.fn<ReturnType<Clean>, Parameters<Clean>>(() =>
      Promise.resolve([]),
    );
    await build(clean).janitor.run();

    expect(clean.mock.calls).toEqual([
      [0, 1000, 'completed'],
      [24 * 3600 * 1000, 1000, 'failed'],
    ]);
  });

  it('keeps cleaning a status until a batch comes back short', async () => {
    const batches: Record<Status, string[][]> = {
      completed: [ids(1000), ids(1000), ids(7)],
      failed: [ids(1000), ids(0)],
    };
    const clean = jest.fn<ReturnType<Clean>, Parameters<Clean>>(
      (_grace, _limit, type) =>
        Promise.resolve(batches[type ?? 'completed'].shift() ?? []),
    );
    const { janitor, log } = build(clean);

    await janitor.run();

    expect(clean.mock.calls.map(([, , type]) => type)).toEqual([
      'completed',
      'completed',
      'completed',
      'failed',
      'failed',
    ]);
    // Counts only, never job data.
    expect(log).toHaveBeenCalledWith(
      `email.queue.janitor ${JSON.stringify({ completed: 2007, failed: 1000 })}`,
    );
  });

  it('logs nothing when there was nothing to remove', async () => {
    const clean = jest.fn<ReturnType<Clean>, Parameters<Clean>>(() =>
      Promise.resolve([]),
    );
    const { janitor, log } = build(clean);
    await janitor.run();
    expect(log).not.toHaveBeenCalled();
  });

  it('swallows and logs a Redis error, and still attempts the failed phase', async () => {
    const clean = jest.fn<ReturnType<Clean>, Parameters<Clean>>(
      (_grace, _limit, type) =>
        type === 'completed'
          ? Promise.reject(new Error('redis down'))
          : Promise.resolve([]),
    );
    const { janitor, warn } = build(clean);

    await expect(janitor.run()).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      'email queue clean (completed) stopped after 0: redis down',
    );
    expect(clean).toHaveBeenCalledWith(24 * 3600 * 1000, 1000, 'failed');
  });

  it('does not hold up bootstrap while the cleaning runs', async () => {
    let release: (value: string[]) => void = () => undefined;
    const clean = jest.fn<ReturnType<Clean>, Parameters<Clean>>(
      (_grace, _limit, type) =>
        type === 'completed'
          ? new Promise<string[]>((resolve) => {
              release = resolve;
            })
          : Promise.resolve([]),
    );
    const { janitor } = build(clean);

    // Returns synchronously (void) although the first clean has not resolved.
    expect(janitor.onApplicationBootstrap()).toBeUndefined();
    expect(clean).toHaveBeenCalledTimes(1);

    release([]);
    await new Promise((r) => setImmediate(r));
    expect(clean).toHaveBeenCalledTimes(2);
  });

  it('never rejects out of bootstrap when the queue throws synchronously', () => {
    const clean = jest.fn<ReturnType<Clean>, Parameters<Clean>>(() => {
      throw new Error('boom');
    });
    const { janitor } = build(clean);
    expect(() => janitor.onApplicationBootstrap()).not.toThrow();
  });
});
