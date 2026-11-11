/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { restoreFeedSnapshot, persistFeedSnapshot, FEED_SNAPSHOT_KEY, MAX_KEPT_POSTS, MAX_PAGE_POSTS } from '../feedSnapshot';
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

describe('feed snapshot: the first page, and what was viewed below it', () => {
  let qc;
  beforeEach(() => {
    localStorage.clear();
    qc = new QueryClient();
    delete window.requestIdleCallback; // jsdom: use the timeout path
  });

  it('keeps the whole first page as fetched, viewed or not, in feed order', async () => {
    persistFeedSnapshot(qc, 'u1');
    await qc.fetchInfiniteQuery({ ...feedQueryOptions('', 'u1'), queryFn: async () => page(20) });
    await flushIdle();
    const snap = saved();
    expect(snap.userId).toBe('u1');
    expect(snap.kept.map((k) => k.post.id)).toEqual(posts(20).map((post) => post.id));
    expect(snap.kept.every((k) => k.page === true)).toBe(true);

    // And that is what the next launch paints.
    const next = new QueryClient();
    expect(restoreFeedSnapshot(next, 'u1')).toBe(true);
    expect(next.getQueryData(key('u1')).pages[0].posts).toHaveLength(20);
  });

  it('keeps no more of the first page than a page', async () => {
    persistFeedSnapshot(qc, 'u1');
    await qc.fetchInfiniteQuery({ ...feedQueryOptions('', 'u1'), queryFn: async () => page(30) });
    await flushIdle();
    expect(saved().kept).toHaveLength(MAX_PAGE_POSTS);
  });

  it('keeps each viewed post whole, with the pictures its row drew', async () => {
    persistFeedSnapshot(qc, 'u1');
    await qc.fetchInfiniteQuery({ ...feedQueryOptions('', 'u1'), queryFn: async () => page(20) });
    notePostViewed('p3', row('https://cdn.example/a.webp'));
    notePostViewed('p1', row());
    await flushIdle();
    const snap = saved();
    const p3 = snap.kept.find((k) => k.post.id === 'p3');
    expect(p3.post).toEqual({ id: 'p3', content: 'post 3', likesCount: 3 });
    expect(p3.media).toEqual(['https://cdn.example/a.webp']);
    expect(p3.viewedAt).toBeGreaterThan(0);
    // Still one of the first page, not counted against the viewed limit.
    expect(p3.page).toBe(true);
    expect(snap.kept.find((k) => k.post.id === 'p5').viewedAt).toBe(0);
  });

  it(`keeps at most the ${MAX_KEPT_POSTS} most recently viewed posts beyond the first page`, async () => {
    persistFeedSnapshot(qc, 'u1');
    // Two pages: p0..p19 is the first, p20..p39 came from scrolling on.
    await qc.fetchInfiniteQuery({
      ...feedQueryOptions('', 'u1'),
      queryFn: async ({ pageParam }) => (pageParam
        ? { posts: posts(40).slice(20), nextCursor: null }
        : { posts: posts(40).slice(0, 20), nextCursor: 'c1' }),
      pages: 2,
    });
    for (let i = 20; i < 40; i += 1) {
      notePostViewed(`p${i}`, row());
      await new Promise((r) => setTimeout(r, 2)); // distinct view times
    }
    await flushIdle();
    const kept = saved().kept;
    const below = kept.filter((k) => !k.page).map((k) => k.post.id);
    expect(kept.filter((k) => k.page)).toHaveLength(20);
    expect(below).toHaveLength(MAX_KEPT_POSTS);
    expect(below).not.toContain('p20');
    expect(below).toContain('p39');
  });

  it('drops an unviewed post that has left the first page, and keeps a viewed one', async () => {
    persistFeedSnapshot(qc, 'u1');
    await qc.fetchInfiniteQuery({ ...feedQueryOptions('', 'u1'), queryFn: async () => page(3) });
    notePostViewed('p1', row());
    await flushIdle();
    // A refresh whose first page no longer has p0, p1 or p2.
    await qc.fetchInfiniteQuery({
      ...feedQueryOptions('', 'u1'),
      staleTime: 0,
      queryFn: async () => ({ posts: [{ id: 'n0' }, { id: 'n1' }], nextCursor: null }),
    });
    await flushIdle();
    const kept = saved().kept;
    expect(kept.filter((k) => k.page).map((k) => k.post.id)).toEqual(['n0', 'n1']);
    expect(kept.filter((k) => !k.page).map((k) => k.post.id)).toEqual(['p1']);
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

  it('refetches behind a snapshot saved seconds ago (the app reopened straight after a post was viewed)', async () => {
    // Viewing a post saves again, so `savedAt` is usually moments before the
    // app was closed. The restored posts must still not count as a fresh feed.
    localStorage.setItem(FEED_SNAPSHOT_KEY, keptSnapshot('u1', ['a'], Date.now() - 3_000));
    expect(restoreFeedSnapshot(qc, 'u1')).toBe(true);
    expect(qc.getQueryState(key('u1')).dataUpdatedAt).toBeLessThan(Date.now() - 60_000);

    // The launch's own request (warmSignedInLanding) goes out and replaces them.
    let asked = 0;
    await qc.prefetchInfiniteQuery({ ...feedQueryOptions('', 'u1'), queryFn: async () => { asked += 1; return page(20); } });
    expect(asked).toBe(1);
    expect(qc.getQueryData(key('u1')).pages[0].posts).toHaveLength(20);
    expect(qc.getQueryData(key('u1')).pages[0].nextCursor).toBe('c1');
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
