/**
 * useProfile — feature-scoped hook for user profile data.
 *
 * Fetches a profile by username with IndexedDB cross-session caching.
 * Includes a prefetch helper for hover-intent loading on profile links.
 */
import { useQuery, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';
import { usersApi } from '@shared/api/apiClient';
import { idbGet, idbSet } from '@shared/lib/idb';
import { useAuth } from '@shared/context/AuthContext';

// ── Query keys ───────────────────────────────────────────────────────────────
export const PROFILE_KEYS = {
  byUsername: (username) => ['profile', username?.toLowerCase()],
  byId:       (id) => ['profile', 'id', id],
  campusUsers: ['users', 'campus'],
};

// ── Hooks ────────────────────────────────────────────────────────────────────

/**
 * Fetches a full profile by username.
 * Seeds from IndexedDB so navigating to a recently-viewed profile is instant.
 */
export function useProfile(username) {
  const queryClient = useQueryClient();
  const qk = PROFILE_KEYS.byUsername(username);

  const query = useQuery({
    queryKey: qk,
    queryFn: async () => {
      const data = await usersApi.getByUsername(username);
      idbSet('profiles', username?.toLowerCase(), data);
      return data;
    },
    enabled: !!username && username !== 'unknown',
    staleTime: 2 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  // If cached data is present but incomplete (missing stats), invalidate to fetch complete profile
  const isDataIncomplete = query.data && !query.data.stats;
  useEffect(() => {
    if (isDataIncomplete && username && username !== 'unknown') {
      queryClient.invalidateQueries({ queryKey: qk });
    }
  }, [isDataIncomplete, username, qk, queryClient]);

  // Hydrate from IndexedDB before first network response
  useEffect(() => {
    if (!username || username === 'unknown' || query.data) return;
    idbGet('profiles', username.toLowerCase()).then((cached) => {
      if (cached?.value && cached.value.stats) {
        queryClient.setQueryData(qk, cached.value);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username]);

  return {
    profile: query.data,
    isLoading: query.isLoading || (query.isFetching && isDataIncomplete),
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

/**
 * Fetches campus users — limited to 50 (not 200) since the full list
 * is only needed for directory browsing, not sidebar lookups.
 */
export function useCampusUsers(limit = 50, { enabled = true } = {}) {
  const queryClient = useQueryClient();
  const { isLoggedIn } = useAuth();

  const query = useQuery({
    queryKey: [...PROFILE_KEYS.campusUsers, limit],
    queryFn: async () => {
      const data = await usersApi.getCampusUsers(limit, 0);
      idbSet('profiles', 'campus_users', data);
      return data;
    },
    enabled: Boolean(isLoggedIn) && enabled,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  useEffect(() => {
    if (query.data) return;
    idbGet('profiles', 'campus_users').then((cached) => {
      if (cached?.value) queryClient.setQueryData([...PROFILE_KEYS.campusUsers, limit], cached.value);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    campusUsers: query.data || [],
    isLoading: query.isLoading,
  };
}

/**
 * Server-driven campus directory: search + course/branch/year filters with cursor-based
 * infinite scrolling. The filters are part of the query key, so each combination
 * is cached independently and a stale in-flight response for an old query can
 * never overwrite the active one (TanStack drops results for inactive keys).
 *
 * @param {{ search?: string, course?: string, branch?: string, year?: string }} filters
 *        Pass an already-debounced `search` so typing doesn't storm the server.
 */
export function useDirectory({ search = '', course = 'All', branch = 'All', year = 'All' } = {}) {
  const { isLoggedIn } = useAuth();
  const normSearch = (search || '').trim();

  const query = useInfiniteQuery({
    queryKey: ['directory', { search: normSearch, course, branch, year }],
    queryFn: ({ pageParam }) =>
      usersApi.getDirectory({ search: normSearch, course, branch, year, limit: 30, cursor: pageParam }),
    enabled: Boolean(isLoggedIn),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage?.nextCursor ?? undefined,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  const users = useMemo(
    () => query.data?.pages?.flatMap((p) => (Array.isArray(p?.users) ? p.users : [])) ?? [],
    [query.data],
  );

  return {
    users,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: query.hasNextPage,
    fetchNextPage: query.fetchNextPage,
    isError: query.isError,
  };
}

/**
 * Prefetch a profile on hover intent — fires before the user clicks.
 */
export function usePrefetchProfile() {
  const queryClient = useQueryClient();
  return useCallback((username) => {
    if (!username || username === 'unknown') return;
    queryClient.prefetchQuery({
      queryKey: PROFILE_KEYS.byUsername(username),
      queryFn: () => usersApi.getByUsername(username),
      staleTime: 2 * 60 * 1000,
    });
  }, [queryClient]);
}

/**
 * Look up a cached user by ID from any in-memory query data.
 * Does NOT trigger a network request — purely reads from cache.
 */
export function useGetUserById() {
  const queryClient = useQueryClient();
  return useCallback((id) => {
    if (!id) return null;
    // Search all queries for a matching user object
    const all = queryClient.getQueriesData({});
    for (const [, data] of all) {
      if (!data) continue;
      if (data.id === id) return data;
      if (Array.isArray(data)) {
        const found = data.find((u) => u?.id === id);
        if (found) return found;
      }
    }
    return null;
  }, [queryClient]);
}
