/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { restoreFeedSnapshot, persistFeedSnapshot, FEED_SNAPSHOT_KEY, MAX_KEPT_POSTS } from '../feedSnapshot';
import { feedQueryOptions } from '../../features/feed/utils/feedQuery';
import { notePostViewed } from '../../shared/lib/offlineFeed';

const posts = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, content: `post ${i}`, likesCount: i }));
const page = (n) => ({ posts: posts(n), nextCursor: 'c1' });
const key = (uid) => feedQueryOptions('', uid).queryKey;
const flushIdle = () => new Promise((r) => setTimeout(r, 600));
const saved = () => JSON.parse(localStorage.getItem(FEED_SNAPSHOT_KEY));
const keptSnapshot = (userId, ids, savedAt = Date.now() - 120_000) => JSON.stringify({
  version: 2,
  userId,
  savedAt,
  kept: ids.map((id, order) => ({ post: { id }, viewedAt: order, order, media: [] })),
});

/** A feed row, as useViewedPosts reports it, drawing one avatar. */
const row = (avatar) => {
  const el = document.createElement('div');
  if (avatar) {
    const img = document.createElement('img');
    img.src = avatar;
    el.appendChild(img);
  }
  return el;
};

describe('feed snapshot: only viewed posts', () => {
  let qc;
  beforeEach(() => {
    localStorage.clear();
    qc = new QueryClient();
    delete window.requestIdleCallback; // jsdom: use the timeout path
  });

  it('keeps nothing for posts that were loaded but never viewed', async () => {
    persistFeedSnapshot(qc, 'u1');
    await qc.fetchInfiniteQuery({ ...feedQueryOptions('', 'u1'), queryFn: async () => page(20) });
    await flushIdle();
    expect(localStorage.getItem(FEED_SNAPSHOT_KEY)).toBeNull();
  });

  it('keeps each viewed post whole, with the pictures its row drew', async () => {
    persistFeedSnapshot(qc, 'u1');
    await qc.fetchInfiniteQuery({ ...feedQueryOptions('', 'u1'), queryFn: async () => page(20) });
    notePostViewed('p3', row('https://cdn.example/a.webp'));
    notePostViewed('p1', row());
    await flushIdle();
    const snap = saved();
    expect(snap.userId).toBe('u1');
    expect(snap.kept.map((k) => k.post.id).sort()).toEqual(['p1', 'p3']);
    const p3 = snap.kept.find((k) => k.post.id === 'p3');
    expect(p3.post).toEqual({ id: 'p3', content: 'post 3', likesCount: 3 });
    expect(p3.media).toEqual(['https://cdn.example/a.webp']);
  });

  it(`keeps at most the ${MAX_KEPT_POSTS} most recently viewed`, async () => {
    persistFeedSnapshot(qc, 'u1');
    await qc.fetchInfiniteQuery({ ...feedQueryOptions('', 'u1'), queryFn: async () => page(30) });
    for (let i = 0; i < 20; i += 1) {
      notePostViewed(`p${i}`, row());
      await new Promise((r) => setTimeout(r, 2)); // distinct view times
    }
    await flushIdle();
    const ids = saved().kept.map((k) => k.post.id);
    expect(ids).toHaveLength(MAX_KEPT_POSTS);
    expect(ids).not.toContain('p0');
    expect(ids).toContain('p19');
  });

  it('refreshes a kept post when the feed fetches it again (counters)', async () => {
    persistFeedSnapshot(qc, 'u1');
    await qc.fetchInfiniteQuery({ ...feedQueryOptions('', 'u1'), queryFn: async () => page(5) });
    notePostViewed('p2', row());
    await flushIdle();
    await qc.fetchInfiniteQuery({
      ...feedQueryOptions('', 'u1'),
      staleTime: 0,
      queryFn: async () => ({ posts: posts(5).map((p) => ({ ...p, likesCount: 99 })), nextCursor: null }),
    });
    await flushIdle();
    expect(saved().kept.find((k) => k.post.id === 'p2').post.likesCount).toBe(99);
  });

  it('ignores a searched feed', async () => {
    persistFeedSnapshot(qc);
    await qc.fetchInfiniteQuery({ ...feedQueryOptions('cats', 'u9'), queryFn: async () => page(4) });
    notePostViewed('p1', row());
    await flushIdle();
    expect(localStorage.getItem(FEED_SNAPSHOT_KEY)).toBeNull();
  });

  it('saves nothing when the cache was cleared before the idle write', async () => {
    persistFeedSnapshot(qc);
    await qc.fetchInfiniteQuery({ ...feedQueryOptions('', 'u9'), queryFn: async () => page(4) });
    notePostViewed('p1', row());
    qc.clear(); // signed out before idle time
    await flushIdle();
    expect(localStorage.getItem(FEED_SNAPSHOT_KEY)).toBeNull();
  });
});

describe('feed snapshot: restoring', () => {
  let qc;
  beforeEach(() => {
    localStorage.clear();
    qc = new QueryClient();
    delete window.requestIdleCallback;
  });

  it('restores the kept posts as stale data, for the same account only', () => {
    localStorage.setItem(FEED_SNAPSHOT_KEY, keptSnapshot('u1', ['a', 'b', 'c']));
    expect(restoreFeedSnapshot(qc, 'u2')).toBe(false);
    expect(qc.getQueryData(key('u2'))).toBeUndefined();

    expect(restoreFeedSnapshot(qc, 'u1')).toBe(true);
    const restored = qc.getQueryData(key('u1')).pages[0];
    expect(restored.posts.map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(restored.nextCursor).toBeUndefined();
    // Stale on purpose: the feed refetches on first use instead of trusting it.
    expect(qc.getQueryState(key('u1')).dataUpdatedAt).toBeLessThan(Date.now() - 60_000);
  });

  it('ignores an old, unreadable or old-format snapshot', () => {
    localStorage.setItem(FEED_SNAPSHOT_KEY, keptSnapshot('u1', ['a'], Date.now() - 8 * 86_400_000));
    expect(restoreFeedSnapshot(qc, 'u1')).toBe(false);
    localStorage.setItem(FEED_SNAPSHOT_KEY, '{oops');
    expect(restoreFeedSnapshot(qc, 'u1')).toBe(false);
    localStorage.setItem(FEED_SNAPSHOT_KEY, JSON.stringify({ userId: 'u1', savedAt: Date.now(), page: page(3) }));
    expect(restoreFeedSnapshot(qc, 'u1')).toBe(false);
  });

  it('does not write back what it just restored', async () => {
    const stored = keptSnapshot('u1', ['a', 'b']);
    localStorage.setItem(FEED_SNAPSHOT_KEY, stored);
    persistFeedSnapshot(qc, 'u1');
    restoreFeedSnapshot(qc, 'u1');
    await flushIdle();
    expect(localStorage.getItem(FEED_SNAPSHOT_KEY)).toBe(stored);
  });
});
