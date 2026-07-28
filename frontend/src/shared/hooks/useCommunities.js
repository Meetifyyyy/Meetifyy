/**
 * useCommunities — feature-scoped hook for community data.
 *
 * Owns the query keys, caching policy, and invalidation for communities.
 * Replaces the communities queries that useData() previously fired unconditionally.
 * Uses IndexedDB for cross-session persistence so the community list appears instantly
 * on next visit before the network response arrives.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';
import { communitiesApi } from '@shared/api/apiClient';
import { idbGet, idbSet } from '@shared/lib/idb';
import { useAuth } from '@shared/context/AuthContext';

// ── Query keys ───────────────────────────────────────────────────────────────
export const COMMUNITY_KEYS = {
  all:    ['communities'],
  campus: ['communities', 'campus'],
  byId:   (id) => ['community', id],
};

// ── Hooks ────────────────────────────────────────────────────────────────────

/**
 * Fetches all communities the user has access to.
 * Cross-session cached in IndexedDB — renders stale data instantly, revalidates in background.
 */
export function useCommunities() {
  const qk = COMMUNITY_KEYS.all;
  const { isLoggedIn } = useAuth();

  const query = useQuery({
    queryKey: qk,
    queryFn: async () => {
      const data = await communitiesApi.getAll();
      // Persist to IndexedDB for next-session instant load
      idbSet('communities', 'all', data);
      return data;
    },
    enabled: isLoggedIn,
    staleTime: 5 * 60 * 1000,   // 5 min
    gcTime:    15 * 60 * 1000,  // 15 min
    placeholderData: (prev) => prev,
  });

  // Hydrate from IndexedDB before first network response
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!query.data) {
      idbGet('communities', 'all').then((cached) => {
        if (cached?.value) {
          queryClient.setQueryData(qk, cached.value);
        }
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const communities = useMemo(() => {
    const arr = [...(query.data || [])];
    (query.data || []).forEach((c) => { if (c?.id) arr[c.id] = c; });
    return arr;
  }, [query.data]);

  return {
    communities,
    rawCommunities: query.data || [],
    isLoading: query.isLoading,
    isError: query.isError,
  };
}

/**
 * Fetches communities belonging to the current user's campus.
 */
export function useCampusCommunities() {
  const qk = COMMUNITY_KEYS.campus;
  const { isLoggedIn } = useAuth();

  const query = useQuery({
    queryKey: qk,
    queryFn: async () => {
      const data = await communitiesApi.getCampusCommunities();
      idbSet('communities', 'campus', data);
      return data;
    },
    enabled: isLoggedIn,
    staleTime: 10 * 60 * 1000,
    gcTime:    30 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  const queryClient = useQueryClient();
  useEffect(() => {
    if (!query.data) {
      idbGet('communities', 'campus').then((cached) => {
        if (cached?.value) queryClient.setQueryData(qk, cached.value);
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    campusCommunities: query.data || [],
    isLoading: query.isLoading,
  };
}

/**
 * Fetches a single community by ID.
 */
export function useCommunityById(id) {
  return useQuery({
    queryKey: COMMUNITY_KEYS.byId(id),
    queryFn: () => communitiesApi.getById(id),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useJoinCommunity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => communitiesApi.join(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: COMMUNITY_KEYS.all }),
  });
}

export function useLeaveCommunity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => communitiesApi.leave(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: COMMUNITY_KEYS.all }),
  });
}

export function useCreateCommunity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => communitiesApi.create(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: COMMUNITY_KEYS.all }),
  });
}

/**
 * Prefetch a community by ID on hover intent.
 */
export function usePrefetchCommunity() {
  const queryClient = useQueryClient();
  return useCallback((id) => {
    if (!id) return;
    queryClient.prefetchQuery({
      queryKey: COMMUNITY_KEYS.byId(id),
      queryFn: () => communitiesApi.getById(id),
      staleTime: 5 * 60 * 1000,
    });
  }, [queryClient]);
}
