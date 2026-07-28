/**
 * useProfile — feature-scoped hook for user profile data.
 *
 * Fetches a profile by username with IndexedDB cross-session caching.
 * Includes a prefetch helper for hover-intent loading on profile links.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { usersApi } from '@shared/api/apiClient';
import { idbGet, idbSet } from '@shared/lib/idb';

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
    enabled: !!username,
    staleTime: 2 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  // Hydrate from IndexedDB before first network response
  useEffect(() => {
    if (!username || query.data) return;
    idbGet('profiles', username.toLowerCase()).then((cached) => {
      if (cached?.value) queryClient.setQueryData(qk, cached.value);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username]);

  return {
    profile: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  };
}

/**
 * Fetches campus users — limited to 50 (not 200) since the full list
 * is only needed for directory browsing, not sidebar lookups.
 */
export function useCampusUsers(limit = 50) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: [...PROFILE_KEYS.campusUsers, limit],
    queryFn: async () => {
      const data = await usersApi.getCampusUsers(limit, 0);
      idbSet('profiles', 'campus_users', data);
      return data;
    },
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
 * Prefetch a profile on hover intent — fires before the user clicks.
 */
export function usePrefetchProfile() {
  const queryClient = useQueryClient();
  return useCallback((username) => {
    if (!username) return;
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
