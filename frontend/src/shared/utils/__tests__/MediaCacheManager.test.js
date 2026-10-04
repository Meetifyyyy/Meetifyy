import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The signed-URL endpoint accepts at most 100 keys and answers a larger request
 * with a 400, which used to fail every key in the queue at once — a long chat
 * gallery came up empty. These pin the chunking, the early flush, the
 * per-chunk isolation, and the generation guard that stops a request in flight
 * across an account switch from writing the previous account's URLs back in.
 */

const post = vi.hoisted(() => vi.fn());

vi.mock('../../api/apiClient', () => ({
  apiClient: { post },
  getMediaUrl: (k) => `https://api.test/api/media/${String(k).replace(/^\/+/, '')}`,
}));
vi.mock('@config', () => ({ config: { storage: { publicUrl: '' } } }));

import { mediaCache } from '../MediaCacheManager';

const keyFor = (i) => `chat/file-${i}.jpg`;
const signAll = (keys) => Object.fromEntries(keys.map((k) => [k, `https://r2.test/${k}?X-Amz-Signature=s`]));

describe('MediaCacheManager batching', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mediaCache.clear();
    post.mockReset();
    post.mockImplementation(async (_url, body) => signAll(body.keys));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('splits 250 distinct keys into three requests of at most 100 keys', async () => {
    const results = Promise.all(Array.from({ length: 250 }, (_, i) => mediaCache.getUrl(keyFor(i))));
    await vi.advanceTimersByTimeAsync(60);
    const urls = await results;

    expect(post).toHaveBeenCalledTimes(3);
    const sizes = post.mock.calls.map(([, body]) => body.keys.length);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(100);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(250);
    expect(urls.every((u) => typeof u === 'string' && u.includes('X-Amz-Signature'))).toBe(true);
  });

  it('flushes as soon as 100 keys are queued, without waiting for the window', async () => {
    const first = Promise.all(Array.from({ length: 100 }, (_, i) => mediaCache.getUrl(keyFor(i))));
    // No timer advance: the 100th key must have triggered the send itself.
    await first;
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][1].keys).toHaveLength(100);
  });

  it('one failing chunk does not fail the others', async () => {
    let call = 0;
    post.mockImplementation(async (_url, body) => {
      call += 1;
      if (call === 2) throw new Error('boom');
      return signAll(body.keys);
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const results = Promise.all(Array.from({ length: 150 }, (_, i) => mediaCache.getUrl(keyFor(i))));
    await vi.advanceTimersByTimeAsync(60);
    const urls = await results;

    const signed = urls.filter((u) => typeof u === 'string').length;
    const nulls = urls.filter((u) => u === null).length;
    expect(signed).toBe(100); // the first (full) chunk survived
    expect(nulls).toBe(50);   // conversation keys of the failed chunk: truthful null
    warn.mockRestore();
  });

  it('never falls back to the unsigned URL for a conversation key', async () => {
    post.mockResolvedValue({});
    const p = mediaCache.getUrl('chat/declined.jpg');
    await vi.advanceTimersByTimeAsync(60);
    expect(await p).toBeNull();
  });

  it('drops the answer of a request that was in flight when clear() ran', async () => {
    let release;
    post.mockImplementation((_url, body) => new Promise((res) => { release = () => res(signAll(body.keys)); }));

    const p = mediaCache.getUrl(keyFor(1));
    await vi.advanceTimersByTimeAsync(60);
    mediaCache.clear(); // account switch while the request is out
    release();

    expect(await p).toBeNull();
    expect(mediaCache.getSyncUrl(keyFor(1))).toBeNull(); // not cached for the next account
  });

  it('clear() releases keys still waiting in the queue and cancels the send', async () => {
    const p = mediaCache.getUrl(keyFor(2));
    mediaCache.clear();
    expect(await p).toBeNull();
    await vi.advanceTimersByTimeAsync(100);
    expect(post).not.toHaveBeenCalled();
  });

  it('a re-requested key keeps its own in-flight promise when the older one settles', async () => {
    let releaseFirst;
    post.mockImplementationOnce((_url, body) => new Promise((res) => { releaseFirst = () => res(signAll(body.keys)); }));
    post.mockImplementation(async (_url, body) => signAll(body.keys));

    const first = mediaCache.getUrl(keyFor(3));
    await vi.advanceTimersByTimeAsync(60);
    mediaCache.invalidate(keyFor(3));
    const second = mediaCache.getUrl(keyFor(3));
    await vi.advanceTimersByTimeAsync(60);
    await second;
    releaseFirst();
    await first;
    expect(post).toHaveBeenCalledTimes(2);
  });
});
