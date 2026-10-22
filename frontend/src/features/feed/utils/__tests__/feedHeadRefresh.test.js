import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, InfiniteQueryObserver } from '@tanstack/query-core';

const getFeed = vi.fn();
vi.mock('@shared/api/apiClient', () => ({ postsApi: { getFeed: (...a) => getFeed(...a) } }));

const { feedQueryOptions, refreshStaleFeedHead, FEED_HEAD_REFRESH_MAX_Y } = await import('../feedQuery');

let round = 0;
const page = (cursor) => {
  const n = cursor ? Number(cursor) : 0;
  return { posts: [{ id: `r${round}-p${n}` }], nextCursor: n < 9 ? String(n + 1) : null };
};

function loadedFeed(pages = 4) {
  const client = new QueryClient();
  const opts = feedQueryOptions('', 'u1');
  const params = Array.from({ length: pages }, (_, i) => (i ? String(i) : undefined));
  client.setQueryData(
    opts.queryKey,
    { pages: params.map(page), pageParams: params },
    // Older than staleTime.
    { updatedAt: Date.now() - 120_000 },
  );
  // Home's observer, mounted as on a return to Home. It is what gives the
  // query its infinite behaviour; with refetchOnMount off it fetches nothing.
  new InfiniteQueryObserver(client, opts).subscribe(() => {});
  const q = client.getQueryCache().find({ queryKey: opts.queryKey, exact: true });
  getFeed.mockClear();
  return { client, key: opts.queryKey, q };
}

describe('feed refresh on return', () => {
  beforeEach(() => {
    round = 0;
    getFeed.mockReset();
    getFeed.mockImplementation(async (_size, cursor) => page(cursor));
  });

  it('turns off the all-pages refetch triggers', () => {
    const o = feedQueryOptions('', 'u1');
    expect(o.refetchOnMount).toBe(false);
    expect(o.refetchOnWindowFocus).toBe(false);
    expect(o.refetchOnReconnect).toBe(false);
  });

  it('pins the library behaviour this works around: a plain refetch requests every page', async () => {
    const { client, key } = loadedFeed(4);
    await client.refetchQueries({ queryKey: key, exact: true });
    expect(getFeed).toHaveBeenCalledTimes(4);
  });

  it('near the top, refetches only the first page and drops the rest', async () => {
    const { client, key } = loadedFeed(4);
    round = 1;
    await refreshStaleFeedHead(client, key, { scrollY: 0 });
    expect(getFeed).toHaveBeenCalledTimes(1);
    expect(getFeed).toHaveBeenCalledWith(20, undefined);
    const data = client.getQueryData(key);
    expect(data.pages).toHaveLength(1);
    expect(data.pages[0].posts[0].id).toBe('r1-p0');
  });

  it('deep in the feed, keeps the list as it is', async () => {
    const { client, key } = loadedFeed(4);
    expect(refreshStaleFeedHead(client, key, { scrollY: FEED_HEAD_REFRESH_MAX_Y + 1 })).toBeNull();
    expect(getFeed).not.toHaveBeenCalled();
    expect(client.getQueryData(key).pages).toHaveLength(4);
  });

  it('does nothing while fresh, or with no data', async () => {
    const { client, key, q } = loadedFeed(2);
    q.setState({ dataUpdatedAt: Date.now() });
    expect(refreshStaleFeedHead(client, key, { scrollY: 0 })).toBeNull();
    expect(refreshStaleFeedHead(new QueryClient(), key)).toBeNull();
    expect(getFeed).not.toHaveBeenCalled();
  });

  it('honours an invalidation (socket sync marks the feed stale without refetching)', async () => {
    const { client, key, q } = loadedFeed(3);
    q.setState({ dataUpdatedAt: Date.now() });
    await client.invalidateQueries({ queryKey: ['feed'], refetchType: 'none' });
    await refreshStaleFeedHead(client, key, { scrollY: 0 });
    expect(getFeed).toHaveBeenCalledTimes(1);
  });

  it('mounting an observer on stale data does not refetch by itself', async () => {
    const { client, key } = loadedFeed(3);
    await new Promise((r) => setTimeout(r, 0));
    expect(getFeed).not.toHaveBeenCalled();
    expect(client.getQueryData(key).pages).toHaveLength(3);
  });

  it('pull-to-refresh (reset) still starts over from one page', async () => {
    const { client, key } = loadedFeed(3);
    await client.resetQueries({ queryKey: key });
    expect(getFeed).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(key).pages).toHaveLength(1);
  });
});
