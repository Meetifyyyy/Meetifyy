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
import { idbGet, idbSet } from '@shared/lib/idb';
import { useAuth } from '@shared/context/AuthContext';

// ── Query keys ───────────────────────────────────────────────────────────────
export const CREW_KEYS = {
  all:       ['activities'],
  campus:    ['activities', 'campus'],
  byId:      (id) => ['activity', id],
  bookmarks: ['activities', 'bookmarks'],
};

// ── Hooks ────────────────────────────────────────────────────────────────────

/**
 * Paginated crew activities with cursor-based infinite scrolling.
 * Hydrates from IndexedDB for instant first render.
 */
export function useActivities() {
  const queryClient = useQueryClient();
  const { isLoggedIn } = useAuth();

  const query = useInfiniteQuery({
    queryKey: CREW_KEYS.all,
    queryFn: async ({ pageParam }) => {
      const data = await activitiesApi.getAll(20, pageParam);
      // Persist first page for next-session instant load
      if (!pageParam) idbSet('activities', 'all_page1', data);
      return data;
    },
    enabled: isLoggedIn,
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage?.nextCursor ?? undefined,
    staleTime: 2 * 60 * 1000,
    gcTime:    10 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  // Hydrate page 1 from IndexedDB before first network response
  useEffect(() => {
    if (!query.data) {
      idbGet('activities', 'all_page1').then((cached) => {
        if (cached?.value) {
          queryClient.setQueryData(CREW_KEYS.all, {
            pages: [cached.value],
            pageParams: [undefined],
          });
        }
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activities = useMemo(
    () => query.data?.pages?.flatMap((p) => p?.activities ?? p ?? []) ?? [],
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
 * Flat (non-paginated) list of activities — for use in dropdowns, sidebars, etc.
 * Reads from the infinite query cache so no extra network call is made.
 */
export function useActivitiesList() {
  const queryClient = useQueryClient();
  const { isLoggedIn } = useAuth();
  const cached = queryClient.getQueryData(CREW_KEYS.all);
  const flat = useMemo(
    () => cached?.pages?.flatMap((p) => p?.activities ?? p ?? []) ?? [],
    [cached]
  );

  // If not in cache yet, run a shallow single-page fetch
  const query = useQuery({
    queryKey: ['activities', 'list'],
    queryFn: () => activitiesApi.getAll(20),
    enabled: Boolean(isLoggedIn) && flat.length === 0,
    staleTime: 2 * 60 * 1000,
    select: (data) => data?.activities ?? data ?? [],
  });

  return flat.length > 0 ? flat : (query.data ?? []);
}

/**
 * Paginated campus-specific activities.
 */
export function useCampusActivities() {
  const queryClient = useQueryClient();
  const { isLoggedIn } = useAuth();

  const query = useInfiniteQuery({
    queryKey: CREW_KEYS.campus,
    queryFn: async ({ pageParam }) => {
      const data = await activitiesApi.getCampusActivities(20, pageParam);
      if (!pageParam) idbSet('activities', 'campus_page1', data);
      return data;
    },
    enabled: isLoggedIn,
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage?.nextCursor ?? undefined,
    staleTime: 5 * 60 * 1000,
    gcTime:    15 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  useEffect(() => {
    if (!query.data) {
      idbGet('activities', 'campus_page1').then((cached) => {
        if (cached?.value) {
          queryClient.setQueryData(CREW_KEYS.campus, {
            pages: [cached.value],
            pageParams: [undefined],
          });
        }
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activities = useMemo(
    () => query.data?.pages?.flatMap((p) => p?.activities ?? p ?? []) ?? [],
    [query.data]
  );

  return {
    campusActivities: activities,
    isLoading: query.isLoading,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: query.hasNextPage,
    fetchNextPage: query.fetchNextPage,
  };
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
    staleTime: 2 * 60 * 1000,
    select: (data) => data?.activities ?? data ?? [],
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
    staleTime: 2 * 60 * 1000,
    select: (data) => data?.activities ?? data ?? [],
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
    staleTime: 2 * 60 * 1000,
    // Try to seed from the list cache to avoid a spinner
    placeholderData: () => {
      const listCache = queryClient.getQueryData(CREW_KEYS.all);
      const all = listCache?.pages?.flatMap((p) => p?.activities ?? p ?? []) ?? [];
      return all.find((a) => a.id === cleanId || a.id === id);
    },
  });
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useJoinActivity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => activitiesApi.join(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CREW_KEYS.all });
      queryClient.invalidateQueries({ queryKey: CREW_KEYS.campus });
    },
  });
}

export function useLeaveActivity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => activitiesApi.leave(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CREW_KEYS.all });
      queryClient.invalidateQueries({ queryKey: CREW_KEYS.campus });
    },
  });
}

export function useCreateActivity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => activitiesApi.create(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CREW_KEYS.all }),
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
