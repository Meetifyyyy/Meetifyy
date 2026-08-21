import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';

// Query-key prefixes that can ever hold post objects — scanning is scoped to
// just these instead of the whole app cache (messages, notifications,
// communities, users, activities, ...). This is called on every render of
// every visible <Post>, so an unscoped scan was O(everything cached in the
// whole app) per post per render — a real jank source in a scrolling feed.
const POST_CACHE_PREFIXES = ['post', 'feed', 'posts', 'user-posts', 'bookmarks', 'community-posts'];

/**
 * `getPostById` as `useData` exposed it — a read-through lookup over the
 * React Query cache that never fetches. Extracted verbatim so the consumers
 * that only needed this one function don't have to subscribe to the whole
 * mega-hook.
 */
export function usePostLookup() {
  const queryClient = useQueryClient();

  return useCallback((id) => {
    if (!id) return null;
    // Fast path: the post's own dedicated cache entry, if present.
    const direct = queryClient.getQueryData(['post', id]);
    if (direct && direct.id === id) return direct;

    const cachedQueries = queryClient.getQueriesData({
      predicate: (query) => POST_CACHE_PREFIXES.includes(query.queryKey[0]),
    });
    for (const [, data] of cachedQueries) {
      if (!data) continue;
      if (data.id === id) return data;
      if (Array.isArray(data.posts)) {
        const found = data.posts.find((p) => p && p.id === id);
        if (found) return found;
      }
      if (Array.isArray(data.pages)) {
        for (const page of data.pages) {
          const list = Array.isArray(page?.posts) ? page.posts : (Array.isArray(page?.items) ? page.items : []);
          const found = list.find((p) => p && p.id === id);
          if (found) return found;
        }
      }
      if (Array.isArray(data)) {
        const found = data.find((p) => p && p.id === id);
        if (found) return found;
      }
    }
    return null;
  }, [queryClient]);
}
