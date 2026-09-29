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

export function feedQueryOptions(searchQuery, userId) {
  return {
    // Scoped to the user and search query.
    queryKey: ['feed', searchQuery, userId],
    queryFn: ({ pageParam = undefined }) => postsApi.getFeed(FEED_PAGE_SIZE, pageParam),
    getNextPageParam: (lastPage) => lastPage?.nextCursor || undefined,
    staleTime: 60_000,
    gcTime: 10 * 60_000,
  };
}
