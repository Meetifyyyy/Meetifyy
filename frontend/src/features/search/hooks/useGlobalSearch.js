import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { searchApi } from '@shared/api/apiClient';
import { useAuth } from '@shared/context/AuthContext';

export function useGlobalSearch(initialQuery = '', limit = 15, type = 'all') {
  const { currentUser } = useAuth();
  const [query, setQuery] = useState(initialQuery);
  const [debouncedQuery, setDebouncedQuery] = useState(initialQuery);

  // Intelligent 180ms debounce for instant search feel without overwhelming API
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedQuery(query);
    }, 180);
    return () => clearTimeout(handler);
  }, [query]);

  // Sync state when URL query changes
  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  const { data, isFetching, isError, refetch } = useQuery({
    queryKey: ['search', debouncedQuery, limit, type],
    queryFn: ({ signal }) => searchApi.globalSearch(debouncedQuery, limit, type, signal),
    enabled: debouncedQuery.length <= 100,
    staleTime: 10000,
  });

  const formatResults = (arr) => (arr || []).map(obj => ({ item: obj }));
  const formatUserResults = (arr) => (arr || [])
    .filter(u => u.id !== currentUser?.id && u.username !== currentUser?.username)
    .map(obj => ({ item: obj }));

  const results = {
    posts: formatResults(data?.posts),
    communities: formatResults(data?.communities),
    users: formatUserResults(data?.users),
    crew: formatResults(data?.activities),
  };

  return {
    query,
    setQuery,
    results,
    isSearching: isFetching,
    isError,
    refetch,
  };
}
