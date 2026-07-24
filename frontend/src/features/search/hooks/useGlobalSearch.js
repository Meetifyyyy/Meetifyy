import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { searchApi } from '@shared/api/apiClient';
import { useAuth } from '@shared/context/AuthContext';

export function useGlobalSearch(initialQuery = '', limit = 5) {
  const { currentUser } = useAuth();
  const [query, setQuery] = useState(initialQuery);
  const [debouncedQuery, setDebouncedQuery] = useState(initialQuery);

  // Debounce the query
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedQuery(query);
    }, 300);
    return () => clearTimeout(handler);
  }, [query]);

  // Sync query state if initialQuery prop changes (like when URL changes)
  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  const { data, isFetching } = useQuery({
    queryKey: ['search', debouncedQuery, limit],
    queryFn: () => searchApi.globalSearch(debouncedQuery, limit),
    enabled: debouncedQuery.trim().length >= 2 && debouncedQuery.length <= 100,
    keepPreviousData: true,
  });

  const formatResults = (arr) => (arr || []).map(obj => ({ item: obj }));
  const formatUserResults = (arr) => (arr || [])
    .filter(u => u.id !== currentUser?.id && u.username !== currentUser?.username)
    .map(obj => ({ item: obj }));

  const results = {
    posts: [],
    communities: formatResults(data?.communities),
    users: formatUserResults(data?.users),
    colleges: [],
    crew: []
  };

  return { query, setQuery, results, isSearching: isFetching };
}
