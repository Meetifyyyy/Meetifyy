import { useMemo } from 'react';
import { useInfiniteQuery, keepPreviousData } from '@tanstack/react-query';
import { searchApi } from '@shared/api/apiClient';
import { useAuth } from '@shared/context/AuthContext';
import { useDebounce } from '@shared/hooks/useDebounce';

export function useGlobalSearch(rawQuery = '', limit = 15, type = 'all') {
  const { currentUser } = useAuth();
  // Short debounce — results are indexed (pg_trgm) + Redis-cached server-side,
  // so we can afford to fire quickly and stay responsive while typing.
  const debouncedQuery = useDebounce(rawQuery, 150);

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
    queryKey: ['search', debouncedQuery, limit, type],
    queryFn: ({ pageParam, signal }) => searchApi.globalSearch(debouncedQuery, limit, type, signal, pageParam),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage?.nextCursor || undefined,
    enabled: debouncedQuery.length <= 100,
    staleTime: 10000,
    // Keep the previous query's pages on screen while a new (keystroke-triggered) query
    // resolves, instead of flashing back to a loading state on every keystroke.
    placeholderData: keepPreviousData,
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
    query: rawQuery,
    results,
    // Only the very first load (no data at all yet) should show a full skeleton;
    // subsequent keystroke-triggered refetches keep prior results visible.
    isLoading: isLoading && !data,
    isSearching: isFetching,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  };
}
