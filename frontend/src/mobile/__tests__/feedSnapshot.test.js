/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { restoreFeedSnapshot, persistFeedSnapshot, FEED_SNAPSHOT_KEY } from '../feedSnapshot';
import { feedQueryOptions } from '../../features/feed/utils/feedQuery';

const page = (n) => ({ posts: Array.from({ length: n }, (_, i) => ({ id: `p${i}` })), nextCursor: 'c1' });
const key = (uid) => feedQueryOptions('', uid).queryKey;
const flushIdle = () => new Promise((r) => setTimeout(r, 600));

describe('feed snapshot', () => {
  let qc;
  beforeEach(() => {
    localStorage.clear();
    qc = new QueryClient();
    delete window.requestIdleCallback; // jsdom: use the timeout path
  });

  it('saves the first page after a real fetch, trimmed and without a cursor', async () => {
    persistFeedSnapshot(qc, 'u1');
    await qc.fetchInfiniteQuery({ ...feedQueryOptions('', 'u1'), queryFn: async () => page(20) });
    await flushIdle();
    const snap = JSON.parse(localStorage.getItem(FEED_SNAPSHOT_KEY));
    expect(snap.userId).toBe('u1');
    expect(snap.page.posts).toHaveLength(12);
    expect(snap.page.nextCursor).toBeUndefined();
  });

  it('restores it as stale data for the same account only', async () => {
    localStorage.setItem(FEED_SNAPSHOT_KEY, JSON.stringify({ userId: 'u1', savedAt: Date.now() - 120_000, page: page(3) }));
    expect(restoreFeedSnapshot(qc, 'u2')).toBe(false);
    expect(qc.getQueryData(key('u2'))).toBeUndefined();

    expect(restoreFeedSnapshot(qc, 'u1')).toBe(true);
    expect(qc.getQueryData(key('u1')).pages[0].posts).toHaveLength(3);
    // Stale on purpose: the feed refetches on first use instead of trusting it.
    expect(qc.getQueryState(key('u1')).dataUpdatedAt).toBeLessThan(Date.now() - 60_000);
  });

  it('ignores a snapshot that is days old or unreadable', () => {
    localStorage.setItem(FEED_SNAPSHOT_KEY, JSON.stringify({ userId: 'u1', savedAt: Date.now() - 4 * 86_400_000, page: page(3) }));
    expect(restoreFeedSnapshot(qc, 'u1')).toBe(false);
    localStorage.setItem(FEED_SNAPSHOT_KEY, '{oops');
    expect(restoreFeedSnapshot(qc, 'u1')).toBe(false);
  });

  it('does not write back what it just restored', async () => {
    const saved = JSON.stringify({ userId: 'u1', savedAt: 1, page: page(3) });
    localStorage.setItem(FEED_SNAPSHOT_KEY, JSON.stringify({ userId: 'u1', savedAt: Date.now() - 1000, page: page(3) }));
    persistFeedSnapshot(qc, 'u1');
    restoreFeedSnapshot(qc, 'u1');
    localStorage.setItem(FEED_SNAPSHOT_KEY, saved);
    await flushIdle();
    expect(localStorage.getItem(FEED_SNAPSHOT_KEY)).toBe(saved);
  });
});
