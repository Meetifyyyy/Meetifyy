/**
 * useCrew — feature-scoped hook for crew activity data.
 *
 * Replaces the activities queries that useData() fired unconditionally.
 * Uses cursor-based infinite scrolling matching the updated backend pagination API.
 * Cross-session IndexedDB persistence for instant first render.
 */
import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';
import { activitiesApi } from '@shared/api/apiClient';
import { idbGet, idbSet, idbDelete } from '@shared/lib/idb';
import { useAuth } from '@shared/context/AuthContext';

// ── Query keys ───────────────────────────────────────────────────────────────
export const CREW_KEYS = {
  all:       ['activities'],
  byId:      (id) => ['activity', id],
  bookmarks: ['activities', 'bookmarks'],
};

// ── Hooks ────────────────────────────────────────────────────────────────────

/**
 * Paginated crew activities with cursor-based infinite scrolling.
 * Hydrates from IndexedDB for instant first render.
 */
export function useActivities(scope = 'public', { enabled = true } = {}) {
  const queryClient = useQueryClient();
  const { isLoggedIn } = useAuth();

  // Each scope ('public' | 'college' | 'one_on_one') gets its own cache entry so
  // the College tab, 1-on-1 tab and Recent feed never clobber one another. The
  // For You preview and the corresponding full-list tab share the same key, so
  // no duplicate fetching happens.
  const queryKey = scope === 'public' ? CREW_KEYS.all : [...CREW_KEYS.all, scope];
  const isPublic = scope === 'public';

  const query = useInfiniteQuery({
    queryKey,
    queryFn: async ({ pageParam }) => {
      const data = await activitiesApi.getAll(20, pageParam, scope);
      // Persist first page of the public feed for next-session instant load
      if (!pageParam && isPublic) idbSet('activities', 'all_page1', data);
      return data;
    },
    enabled: isLoggedIn && enabled,
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage?.nextCursor ?? undefined,
    // IDB hydration fills the gap between mount and network response (below).
    // 30s staleTime matches the global default — activities don't change faster
    // than that and mutations already invalidate via queryClient.invalidateQueries.
    staleTime: 30_000,
    refetchOnMount: true,
    gcTime: 10 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  // Hydrate page 1 from IndexedDB only when there is no live data yet.
  // staleTime:0 + refetchOnMount:'always' ensures the real fetch fires immediately;
  // IDB just fills the gap so the page isn't blank while the network responds.
  // Only the public feed is persisted/hydrated.
  useEffect(() => {
    if (!isPublic) return;
    idbGet('activities', 'all_page1').then((cached) => {
      // Never overwrite live server data with stale IDB data
      if (cached?.value && !queryClient.getQueryData(CREW_KEYS.all)) {
        queryClient.setQueryData(CREW_KEYS.all, {
          pages: [cached.value],
          pageParams: [undefined],
        });
        // No need to invalidate — the active query is already fetching
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPublic]);

  const activities = useMemo(
    () => query.data?.pages?.flatMap((p) => (Array.isArray(p?.activities) ? p.activities : (Array.isArray(p) ? p : []))) ?? [],
    [query.data]
  );

  return {
    activities,
    isLoading: query.isLoading,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: query.hasNextPage,
    fetchNextPage: query.fetchNextPage,
    isError: query.isError,
  };
}

/**
 * Composed "For You" discovery payload: college + 1-on-1 previews in one request.
 * Recent is served by useActivities('public'), not this hook.
 */
export function useCrewDiscover() {
  const { isLoggedIn } = useAuth();
  const query = useQuery({
    queryKey: [...CREW_KEYS.all, 'discover'],
    queryFn: () => activitiesApi.getDiscover(),
    enabled: isLoggedIn,
    staleTime: 30_000,
    refetchOnMount: true,
  });

  const empty = { items: [], hasMore: false };
  return {
    collegeName: query.data?.collegeName || null,
    collegeId: query.data?.collegeId || null,
    college: query.data?.college || empty,
    oneOnOne: query.data?.oneOnOne || empty,
    isLoading: query.isLoading,
  };
}

/**
 * Flat (non-paginated) list of activities — for use in dropdowns, sidebars, etc.
 * Reads from the infinite query cache so no extra network call is made.
 */
export function useActivitiesList() {
  const queryClient = useQueryClient();
  const { isLoggedIn } = useAuth();
  const cached = queryClient.getQueryData(CREW_KEYS.all);
  const flat = useMemo(
    () => cached?.pages?.flatMap((p) => (Array.isArray(p?.activities) ? p.activities : (Array.isArray(p) ? p : []))) ?? [],
    [cached]
  );

  // If not in cache yet, run a shallow single-page fetch
  const query = useQuery({
    queryKey: ['activities', 'list'],
    queryFn: () => activitiesApi.getAll(20),
    enabled: Boolean(isLoggedIn) && flat.length === 0,
    staleTime: 0,
    refetchOnMount: 'always',
    select: (data) => (Array.isArray(data?.activities) ? data.activities : (Array.isArray(data) ? data : [])),
  });

  return flat.length > 0 ? flat : (query.data ?? []);
}

/**
 * Saved/bookmarked activities.
 */
export function useSavedActivitiesQuery() {
  const { isLoggedIn } = useAuth();
  const query = useQuery({
    queryKey: CREW_KEYS.bookmarks,
    queryFn: () => activitiesApi.getBookmarks(),
    enabled: isLoggedIn,
    staleTime: 0,
    refetchOnMount: 'always',
    select: (data) => (Array.isArray(data?.activities) ? data.activities : (Array.isArray(data) ? data : [])),
  });

  return {
    savedActivitiesData: query.data || [],
    isLoading: query.isLoading,
  };
}

/**
 * User's joined & created activities (both ongoing and past).
 */
export function useMyActivitiesQuery() {
  const { isLoggedIn } = useAuth();
  const query = useQuery({
    queryKey: ['activities', 'me'],
    queryFn: () => activitiesApi.getMyActivities(),
    enabled: isLoggedIn,
    staleTime: 0,
    refetchOnMount: 'always',
    select: (data) => (Array.isArray(data?.activities) ? data.activities : (Array.isArray(data) ? data : [])),
  });

  return {
    myActivitiesData: query.data || [],
    isLoading: query.isLoading,
  };
}

/**
 * Single activity by ID.
 */
export function useActivityById(id) {
  const queryClient = useQueryClient();
  const cleanId = id ? String(id).replace(/^(act_)+/, '') : id;

  return useQuery({
    queryKey: CREW_KEYS.byId(cleanId),
    queryFn: () => activitiesApi.getById(cleanId),
    enabled: !!cleanId,
    // Always re-validate on mount so isJoined is always authoritative from the server.
    // The optimistic update already has the cache showing the right state instantly;
    // this background re-fetch just confirms it without any visible spinner.
    staleTime: 0,
    refetchOnMount: 'always',
    // Try to seed from the list cache to avoid a spinner on first load.
    // Note: list-cache entries may have isJoined missing (anonymous base cache),
    // so we only use them as shape placeholders — the real query always fires.
    placeholderData: () => {
      const listCache = queryClient.getQueryData(CREW_KEYS.all);
      const all = listCache?.pages?.flatMap((p) => (Array.isArray(p?.activities) ? p.activities : (Array.isArray(p) ? p : []))) ?? [];
      return all.find((a) => a && (a.id === cleanId || a.id === id));
    },
  });
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useJoinActivity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => activitiesApi.join(id),
    onSuccess: (data, id) => {
      // Clear IDB so next session doesn't restore stale pre-join state
      idbDelete('activities', 'all_page1');
      queryClient.invalidateQueries({ queryKey: ['activities'], refetchType: 'active' });
      queryClient.invalidateQueries({ queryKey: ['activity'], refetchType: 'active' });
      if (id) queryClient.invalidateQueries({ queryKey: CREW_KEYS.byId(id), refetchType: 'active' });
    },
  });
}

export function useLeaveActivity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => activitiesApi.leave(id),
    onSuccess: (data, id) => {
      idbDelete('activities', 'all_page1');
      queryClient.invalidateQueries({ queryKey: ['activities'], refetchType: 'active' });
      queryClient.invalidateQueries({ queryKey: ['activity'], refetchType: 'active' });
      if (id) queryClient.invalidateQueries({ queryKey: CREW_KEYS.byId(id), refetchType: 'active' });
    },
  });
}

export function useCreateActivity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => activitiesApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['activities'] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
    },
  });
}

/**
 * Prefetch an activity card on hover intent.
 */
export function usePrefetchActivity() {
  const queryClient = useQueryClient();
  return useCallback((id) => {
    if (!id) return;
    queryClient.prefetchQuery({
      queryKey: CREW_KEYS.byId(id),
      queryFn: () => activitiesApi.getById(id),
      staleTime: 2 * 60 * 1000,
    });
  }, [queryClient]);
}
