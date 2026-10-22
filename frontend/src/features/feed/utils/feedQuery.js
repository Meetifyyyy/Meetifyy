import { onlineManager } from '@tanstack/react-query';
import { postsApi } from '@shared/api/apiClient';

/**
 * The home feed's query, in one place.
 *
 * `Feed` renders it, and the installed app's entry starts it early — in
 * parallel with restoring the session, rather than after the session, the
 * redirect to /home and the route chunk have all finished. The two must build
 * the same key and the same pages or the early fetch is a wasted request, so
 * neither spells them out itself.
 */
export const FEED_PAGE_SIZE = 20;
const FEED_STALE_MS = 60_000;

export function feedQueryOptions(searchQuery, userId) {
  return {
    // Scoped to the user and search query.
    queryKey: ['feed', searchQuery, userId],
    queryFn: ({ pageParam = undefined }) => postsApi.getFeed(FEED_PAGE_SIZE, pageParam),
    getNextPageParam: (lastPage) => lastPage?.nextCursor || undefined,
    staleTime: FEED_STALE_MS,
    gcTime: 10 * 60_000,
    // Each of these would refetch EVERY loaded page in sequence; Home asks for
    // the first page alone instead — see `refreshStaleFeedHead`. A query with
    // no data still fetches on mount regardless.
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  };
}

/**
 * How near the top counts as "at the top" when deciding whether a stale feed
 * may be refreshed in place. Roughly one phone screen.
 */
export const FEED_HEAD_REFRESH_MAX_Y = 600;

/**
 * Refresh a stale feed by its FIRST page only — or not at all.
 *
 * Why not TanStack's own refetch-on-mount/focus: for an infinite query v5
 * refetches every loaded page, one after another, each from the cursor the
 * previous fresh page returned (query-core `infiniteQueryBehavior`). Coming
 * back to Home after scrolling ten pages cost ten sequential requests on mobile
 * data, and because a ranked feed's pages are recomputed, the rows the user was
 * looking at moved under their thumb when the batch landed.
 *
 * So `feedQueryOptions` turns those refetches off, and Home calls this on
 * return and on focus instead:
 *
 * - near the top, the cached list is cut to its first page and that page is
 *   refetched — one request; the old rows stay painted until it lands, and
 *   further pages load as the user scrolls, as on first visit;
 * - further down, nothing happens. Keeping their place matters more than
 *   freshness there; pull-to-refresh is one gesture away, and the cache is
 *   dropped after `gcTime` anyway.
 *
 * Returns the refetch promise, or null when nothing was done.
 */
export function refreshStaleFeedHead(queryClient, queryKey, { scrollY = 0 } = {}) {
  const query = queryClient.getQueryCache().find({ queryKey, exact: true });
  if (!query || !query.state.data) return null;
  if (query.state.fetchStatus === 'fetching') return null;
  // By time, not `isStale()`: with no observer mounted that only reports an
  // explicit invalidation, and this also runs before Home's observer exists.
  if (!query.isStaleByTime(FEED_STALE_MS)) return null;
  if (scrollY > FEED_HEAD_REFRESH_MAX_Y) return null;
  // Offline it could only fail, and the trim below would have thrown away the
  // pages the user can still read.
  if (!onlineManager.isOnline()) return null;

  const previous = query.state.data;
  const previousUpdatedAt = query.state.dataUpdatedAt;
  const { pages = [], pageParams = [] } = previous;
  const trimmed = pages.length > 1;
  if (trimmed) {
    queryClient.setQueryData(
      queryKey,
      { pages: pages.slice(0, 1), pageParams: pageParams.slice(0, 1) },
      // Kept stale: this trims what is cached, it is not a fetch.
      { updatedAt: previousUpdatedAt },
    );
  }
  return queryClient.refetchQueries({ queryKey, exact: true }, { throwOnError: false }).then(() => {
    // The refresh failed (nothing newer landed): put back the pages it
    // trimmed, rather than leave a one-page feed behind a failed request.
    const after = queryClient.getQueryState(queryKey);
    if (trimmed && after && after.dataUpdatedAt === previousUpdatedAt) {
      queryClient.setQueryData(queryKey, previous, { updatedAt: previousUpdatedAt });
    }
  });
}
