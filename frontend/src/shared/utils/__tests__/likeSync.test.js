import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toggleLike, readLike, applyRemoteLike, __resetLikeSync } from '../likeSync';

/** A request the test resolves by hand, to model a slow network precisely. */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** A fake server: records every request; each one waits until released. */
function harness(initial = { liked: false, count: 3 }) {
  const requests = [];
  const shownLog = [];
  const io = {
    send: vi.fn((liked) => {
      const d = deferred();
      requests.push({ liked, ...d });
      return d.promise;
    }),
    write: vi.fn((shown) => shownLog.push(shown.count)),
    onError: vi.fn(),
  };
  const tap = () => toggleLike('post:1', initial, io);
  return { io, requests, shownLog, tap };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => { vi.useRealTimers(); __resetLikeSync(); });
afterEach(() => __resetLikeSync());

describe('rapid tapping', () => {
  it('is instant, and like → unlike → like sends one request and never jumps', async () => {
    const { requests, shownLog, tap } = harness();
    expect(tap()).toEqual({ liked: true, count: 4 });
    expect(tap()).toEqual({ liked: false, count: 3 });
    expect(tap()).toEqual({ liked: true, count: 4 });
    await flush();
    expect(requests.map((r) => r.liked)).toEqual([true]);

    requests[0].resolve({ liked: true, likeCount: 4, version: 10 });
    await flush();
    expect(requests).toHaveLength(1); // the server already matches the last tap
    expect(readLike('post:1', null)).toEqual({ liked: true, count: 4 });
    // Every count ever shown was 3 or 4: no 2, no 5.
    expect(new Set(shownLog)).toEqual(new Set([3, 4]));
  });

  it('serialises: the follow-up is sent only after the first answer, in tap order', async () => {
    const { requests, tap } = harness();
    tap(); // like
    await flush();
    tap(); // unlike while the like is in flight
    await flush();
    expect(requests).toHaveLength(1);

    requests[0].resolve({ liked: true, likeCount: 4, version: 10 });
    await flush();
    expect(requests.map((r) => r.liked)).toEqual([true, false]);
    requests[1].resolve({ liked: false, likeCount: 3, version: 11 });
    await flush();
    expect(readLike('post:1', null)).toEqual({ liked: false, count: 3 });
  });

  it('keeps an odd burst of 25 taps to two requests and ends on the last tap', async () => {
    const { requests, tap } = harness();
    for (let i = 0; i < 25; i += 1) tap();
    await flush();
    requests[0].resolve({ liked: true, likeCount: 4, version: 10 });
    await flush();
    // 25 taps from unliked = liked; the first request already made it so.
    expect(requests).toHaveLength(1);
    expect(readLike('post:1', null)).toEqual({ liked: true, count: 4 });
  });
});

describe('out-of-order and concurrent changes', () => {
  it('folds in another person\'s like while mine is pending, without moving my heart', async () => {
    const { requests, tap } = harness();
    tap(); // I like: 3 → 4
    await flush();
    // Someone else likes first on the server: count 4, before mine lands.
    expect(applyRemoteLike('post:1', { count: 4, version: 9, liked: true, byMe: false }))
      .toEqual({ liked: true, count: 5 });
    requests[0].resolve({ liked: true, likeCount: 5, version: 10 });
    await flush();
    expect(readLike('post:1', null)).toEqual({ liked: true, count: 5 });
  });

  it('drops an event older than an answer already applied', async () => {
    const { requests, tap } = harness();
    tap();
    await flush();
    requests[0].resolve({ liked: true, likeCount: 6, version: 20 });
    await flush();
    expect(applyRemoteLike('post:1', { count: 4, version: 15 })).toBeNull();
    expect(readLike('post:1', null)).toEqual({ liked: true, count: 6 });
  });

  it('applies events with no local activity, newest only', () => {
    expect(applyRemoteLike('post:9', { count: 7, version: 5 })).toEqual({ count: 7 });
    expect(applyRemoteLike('post:9', { count: 6, version: 4 })).toBeNull();
    expect(applyRemoteLike('post:9', { count: 6, version: 5 })).toBeNull(); // duplicate
    expect(applyRemoteLike('post:9', { count: 8, version: 6 })).toEqual({ count: 8 });
  });

  it('takes the heart from my other device, never from someone else', () => {
    expect(applyRemoteLike('post:2', { count: 1, version: 1, liked: true, byMe: false })).toEqual({ count: 1 });
    expect(applyRemoteLike('post:2', { count: 2, version: 2, liked: true, byMe: true })).toEqual({ count: 2, liked: true });
  });

  it('ignores an unversioned event while something is pending', async () => {
    const { tap } = harness();
    tap();
    expect(applyRemoteLike('post:1', { count: 99 })).toBeNull();
    expect(readLike('post:1', null)).toEqual({ liked: true, count: 4 });
  });
});

describe('failures', () => {
  it('returns to the last confirmed state, not to the opposite of the last tap', async () => {
    const { io, requests, tap } = harness();
    tap(); // like
    await flush();
    requests[0].resolve({ liked: true, likeCount: 4, version: 10 });
    await flush();
    tap(); // unlike
    await flush();
    tap(); // like again while the unlike is in flight
    requests[1].reject(new Error('offline'));
    await flush();
    expect(readLike('post:1', null)).toEqual({ liked: true, count: 4 });
    expect(io.onError).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(2); // no retry storm
  });

  it('rolls a first-tap failure back to the original state', async () => {
    const { requests, tap } = harness();
    tap();
    await flush();
    requests[0].reject(new Error('500'));
    await flush();
    expect(readLike('post:1', null)).toEqual({ liked: false, count: 3 });
  });
});

describe('fetched snapshots', () => {
  it('keeps the confirmed state over a stale refetch for the grace period, then defers to the cache', async () => {
    vi.useFakeTimers();
    const io = { send: vi.fn(async () => ({ liked: true, likeCount: 4, version: 10 })), write: vi.fn() };
    toggleLike('post:1', { liked: false, count: 3 }, io);
    await vi.runAllTicks();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    const stale = { liked: false, count: 3 };
    expect(readLike('post:1', stale)).toEqual({ liked: true, count: 4 });
    vi.advanceTimersByTime(6000);
    expect(readLike('post:1', stale)).toBe(stale);
  });

  it('works with an API that returns no count, stepping the confirmed one', async () => {
    const io = { send: vi.fn(async () => ({ success: true })), write: vi.fn() };
    toggleLike('comment:1', { liked: false, count: 0 }, io);
    await flush();
    expect(readLike('comment:1', null)).toEqual({ liked: true, count: 1 });
  });
});
