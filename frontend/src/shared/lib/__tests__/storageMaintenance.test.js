import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * The launch-time housekeeping runs once, when the browser is idle, and one
 * failing step does not stop the others.
 */

const calls = vi.hoisted(() => []);
const failing = vi.hoisted(() => ({ cache: false }));

vi.mock('../idb', () => ({
  idbMaintainCache: async () => {
    calls.push('cache');
    if (failing.cache) throw new Error('boom');
  },
}));
vi.mock('../../../features/messages/shared/utils/idbMessages', () => ({
  trimMessageCache: async () => { calls.push('messages'); },
}));
vi.mock('../../utils/draftImageCache', () => ({
  cleanupDraftImages: async () => { calls.push('drafts'); },
}));

let mod;
beforeEach(async () => {
  calls.length = 0;
  failing.cache = false;
  vi.resetModules();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  mod = await import('../storageMaintenance');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const flush = () => new Promise((r) => setTimeout(r, 10));

describe('scheduleStorageMaintenance', () => {
  it('waits for an idle callback instead of running on the render path', async () => {
    const requestIdleCallback = vi.fn();
    vi.stubGlobal('window', { requestIdleCallback });

    expect(mod.scheduleStorageMaintenance()).toBe(true);

    expect(requestIdleCallback).toHaveBeenCalledTimes(1);
    expect(requestIdleCallback.mock.calls[0][1]).toMatchObject({ timeout: expect.any(Number) });
    await flush();
    expect(calls).toEqual([]); // nothing until the browser says it is idle
  });

  it('runs the cache, message and draft passes in that order once idle', async () => {
    let idle;
    vi.stubGlobal('window', { requestIdleCallback: (cb) => { idle = cb; } });
    mod.scheduleStorageMaintenance();

    idle();
    await flush();

    expect(calls).toEqual(['cache', 'messages', 'drafts']);
  });

  it('schedules at most once per launch', () => {
    const requestIdleCallback = vi.fn();
    vi.stubGlobal('window', { requestIdleCallback });

    expect(mod.scheduleStorageMaintenance()).toBe(true);
    expect(mod.scheduleStorageMaintenance()).toBe(false);
    expect(requestIdleCallback).toHaveBeenCalledTimes(1);
  });

  it('falls back to a delayed timer where requestIdleCallback does not exist', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', {});

    mod.scheduleStorageMaintenance();
    expect(calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toEqual([]); // not yet: the first screen gets to settle
    await vi.advanceTimersByTimeAsync(10_000);

    expect(calls).toEqual(['cache', 'messages', 'drafts']);
  });

  it('carries on past a failing step', async () => {
    failing.cache = true;
    await mod.runStorageMaintenance();
    expect(calls).toEqual(['cache', 'messages', 'drafts']);
  });
});
