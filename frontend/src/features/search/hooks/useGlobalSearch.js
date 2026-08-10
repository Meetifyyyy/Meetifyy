import { useMemo } from 'react';
import { useInfiniteQuery, keepPreviousData } from '@tanstack/react-query';
import { searchApi } from '@shared/api/apiClient';
import { useAuth } from '@shared/context/AuthContext';

export function useGlobalSearch(query = '', limit = 15, type = 'all') {
  const { currentUser } = useAuth();
  const cleanQuery = (query || '').trim();

  const {
    data,
    isLoading,
    isFetching,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['search', cleanQuery, limit, type],
    queryFn: ({ pageParam, signal }) => searchApi.globalSearch(cleanQuery, limit, type, signal, pageParam),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage?.nextCursor || undefined,
    enabled: cleanQuery.length <= 100,
    // Keep search results fresh long enough that returning to the page (e.g. Back
    // from a profile/activity the user opened from results) restores the exact
    // list — including every loaded page and scroll position — instantly from
    // cache with NO refetch. A short 10s window used to make Back feel slow: the
    // query went stale and refetched on remount. 5 min matches typical browse time.
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 15,
    // Don't refetch just because the component remounted (that's what Back does).
    // If the cached data is still within staleTime it's served as-is; a genuinely
    // new query is a different queryKey and fetches normally.
    refetchOnMount: false,
    // Only keep previous data when switching between active search queries (e.g. "app" -> "appl"),
    // but drop previous data immediately when clearing to empty query so old search results don't linger.
    placeholderData: cleanQuery ? keepPreviousData : undefined,
  });

  const pages = data?.pages || [];
  const formatResults = (arr) => (arr || []).map(obj => ({ item: obj }));
  const formatUserResults = (arr) => (arr || [])
    .filter(u => u.id !== currentUser?.id && u.username !== currentUser?.username)
    .map(obj => ({ item: obj }));

  const results = useMemo(() => ({
    posts: formatResults(pages.flatMap(p => p.posts || [])),
    communities: formatResults(pages[0]?.communities),
    users: formatUserResults(pages[0]?.users),
    crew: formatResults(pages.flatMap(p => p.activities || [])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [pages, currentUser?.id, currentUser?.username]);

  return {
    query: cleanQuery,
    results,
    isLoading: isLoading && !data,
    isSearching: isFetching,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  };
}

