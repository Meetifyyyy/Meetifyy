// sanitize-html is ESM-only under ts-jest; the modules below reach it through
// the email module and never sanitize here.
jest.mock('../utils/sanitize-html.util', () => ({}));

import type { Queue } from 'bullmq';
import { AccountDeletionModule } from '../../account-deletion/account-deletion.module';
import type { AccountDeletionPurgeService } from '../../account-deletion/account-deletion.purge.service';
import { PURGE_SWEEP_MS } from '../../account-deletion/account-deletion.constants';
import { EXPIRY_SWEEP_MS } from '../../instant-match/instant-match.constants';
import { InstantMatchModule } from '../../instant-match/instant-match.module';
import type { InstantMatchService } from '../../instant-match/instant-match.service';
import { setRequestExpiryScheduler } from '../../instant-match/instant-match.service';
import {
  AFFINITY_REBUILD_MS,
  JOB_AFFINITY_REBUILD,
} from '../../ranking/ranking.constants';
import { RankingModule } from '../../ranking/ranking.module';
import { stub } from '../testing/stub';
import {
  REGISTRATION_LOG_INTERVAL_MS,
  registerInBackground,
} from './background-registration';

/** A queue whose first `failures` adds reject, then every add resolves. */
function flakyQueue(failures: number) {
  let remaining = failures;
  const add = jest.fn((..._args: unknown[]) => {
    if (remaining > 0) {
      remaining -= 1;
      return Promise.reject(new Error('Queue connection not ready'));
    }
    return Promise.resolve({ id: 'job' });
  });
  return { add, queue: { add } as unknown as Queue };
}

const flush = () => jest.advanceTimersByTimeAsync(0);

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('registerInBackground', () => {
  const logger = () => ({ error: jest.fn(), warn: jest.fn() });

  it('does not wait for the registration', () => {
    const attempt = jest.fn(() => new Promise<void>(() => undefined));
    const registration = registerInBackground({
      description: 'a sweep',
      logger: logger(),
      attempt,
    });
    // Returned at once, with the attempt already started and still pending.
    expect(attempt).toHaveBeenCalledTimes(1);
    registration.stop();
  });

  it('retries until the registration is accepted, then stops', async () => {
    let failures = 4;
    const attempt = jest.fn(() =>
      failures-- > 0 ? Promise.reject(new Error('down')) : Promise.resolve(),
    );
    registerInBackground({ description: 'a sweep', logger: logger(), attempt });

    await flush();
    expect(attempt).toHaveBeenCalledTimes(1);
    // Backoff tops out at 6 s, so 4 failures are retried well within 30 s.
    await jest.advanceTimersByTimeAsync(30_000);
    expect(attempt).toHaveBeenCalledTimes(5);

    await jest.advanceTimersByTimeAsync(10 * 60_000);
    expect(attempt).toHaveBeenCalledTimes(5);
  });

  it('never gives up however long Redis stays away', async () => {
    const attempt = jest.fn(() => Promise.reject(new Error('down')));
    const registration = registerInBackground({
      description: 'a sweep',
      logger: logger(),
      attempt,
    });
    await jest.advanceTimersByTimeAsync(60 * 60_000);
    // One attempt per ~5 s ceiling for an hour.
    expect(attempt.mock.calls.length).toBeGreaterThan(400);
    registration.stop();
  });

  it('logs the first failure, then at most once a minute', async () => {
    const log = logger();
    const onFirstFailure = jest.fn();
    const registration = registerInBackground({
      description: 'a sweep',
      logger: log,
      attempt: () => Promise.reject(new Error('down')),
      onFirstFailure,
    });

    await jest.advanceTimersByTimeAsync(REGISTRATION_LOG_INTERVAL_MS * 2.5);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(onFirstFailure).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledTimes(2);
    registration.stop();
  });

  it('stops retrying when asked', async () => {
    const attempt = jest.fn(() => Promise.reject(new Error('down')));
    const registration = registerInBackground({
      description: 'a sweep',
      logger: logger(),
      attempt,
    });
    await jest.advanceTimersByTimeAsync(10_000);
    registration.stop();
    const calls = attempt.mock.calls.length;
    await jest.advanceTimersByTimeAsync(60_000);
    expect(attempt).toHaveBeenCalledTimes(calls);
  });
});

describe('RankingModule', () => {
  it('does not hold boot, and schedules once the queue accepts', async () => {
    const { add, queue } = flakyQueue(3);
    const module = new RankingModule(queue);

    // Synchronous: boot does not await the registration.
    expect(module.onModuleInit()).toBeUndefined();
    await flush();
    expect(add).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(30_000);
    expect(add).toHaveBeenCalledTimes(4);
    expect(add).toHaveBeenLastCalledWith(
      JOB_AFFINITY_REBUILD,
      {},
      expect.objectContaining({
        repeat: { every: AFFINITY_REBUILD_MS },
        jobId: JOB_AFFINITY_REBUILD,
      }),
    );

    await jest.advanceTimersByTimeAsync(10 * 60_000);
    expect(add).toHaveBeenCalledTimes(4);
    module.onModuleDestroy();
  });

  it('is still scheduled after Redis has been away for a long time', async () => {
    const { add, queue } = flakyQueue(300);
    const module = new RankingModule(queue);
    module.onModuleInit();

    await jest.advanceTimersByTimeAsync(60 * 60_000);
    expect(add).toHaveBeenCalledTimes(301);
    module.onModuleDestroy();
  });
});

describe('AccountDeletionModule', () => {
  const build = (failures: number) => {
    const { add, queue } = flakyQueue(failures);
    const runSweep = jest.fn(() => Promise.resolve());
    const module = new AccountDeletionModule(
      queue,
      stub<AccountDeletionPurgeService>({ runSweep }),
    );
    return { add, runSweep, module };
  };

  it('does not hold boot, and arms no fallback when the queue accepts', async () => {
    const { add, runSweep, module } = build(0);
    expect(module.onModuleInit()).toBeUndefined();
    await flush();
    expect(add).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(PURGE_SWEEP_MS * 2);
    expect(runSweep).not.toHaveBeenCalled();
    module.onModuleDestroy();
  });

  it('keeps retrying the queue and arms the in-process fallback once', async () => {
    const { add, runSweep, module } = build(5);
    module.onModuleInit();
    await flush();

    await jest.advanceTimersByTimeAsync(60_000);
    expect(add).toHaveBeenCalledTimes(6);

    await jest.advanceTimersByTimeAsync(PURGE_SWEEP_MS);
    // One timer, not one per failed attempt.
    expect(runSweep).toHaveBeenCalledTimes(1);
    module.onModuleDestroy();

    await jest.advanceTimersByTimeAsync(PURGE_SWEEP_MS * 2);
    expect(runSweep).toHaveBeenCalledTimes(1);
  });
});

describe('InstantMatchModule', () => {
  afterEach(() => setRequestExpiryScheduler(null));

  const build = (failures: number) => {
    const { add, queue } = flakyQueue(failures);
    const expireStale = jest.fn(() => Promise.resolve());
    const module = new InstantMatchModule(
      queue,
      stub<InstantMatchService>({ expireStale }),
    );
    return { add, expireStale, module };
  };

  it('does not hold boot, and arms no fallback when the queue accepts', async () => {
    const { add, expireStale, module } = build(0);
    expect(module.onModuleInit()).toBeUndefined();
    await flush();
    expect(add).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(EXPIRY_SWEEP_MS * 3);
    expect(expireStale).not.toHaveBeenCalled();
    module.onModuleDestroy();
  });

  it('keeps retrying the queue and arms the in-process fallback once', async () => {
    const { add, expireStale, module } = build(5);
    module.onModuleInit();
    await flush();

    await jest.advanceTimersByTimeAsync(60_000);
    expect(add).toHaveBeenCalledTimes(6);
    const sweeps = Math.floor(60_000 / EXPIRY_SWEEP_MS);
    expect(expireStale.mock.calls.length).toBeGreaterThanOrEqual(sweeps - 1);
    expect(expireStale.mock.calls.length).toBeLessThanOrEqual(sweeps + 1);
    module.onModuleDestroy();
  });
});
