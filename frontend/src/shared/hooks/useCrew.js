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
import { mapActivity } from '@shared/utils/mapActivity';

// ── Query keys ───────────────────────────────────────────────────────────────
export const CREW_KEYS = {
  all:       ['activities'],
  byId:      (id) => ['activity', id],
  bookmarks: ['activities', 'bookmarks'],
};

/**
 * Looks up an activity across every cached Crew list — the paginated feeds
 * (whose data is `{ pages: [{ activities }] }`) and the composed discover
 * payload (whose sections are `{ items }`). Purely a cache read: no network,
 * no access decision, and the result is only ever used as a render placeholder.
 */
function findActivityInListCaches(queryClient, ...ids) {
  const wanted = new Set(ids.filter(Boolean).map(String));
  if (wanted.size === 0) return undefined;

  const entries = queryClient.getQueriesData({ queryKey: CREW_KEYS.all });
  for (const [, data] of entries) {
    if (!data) continue;

    const candidates = [];
    if (Array.isArray(data?.pages)) {
      for (const page of data.pages) {
        if (Array.isArray(page?.activities)) candidates.push(...page.activities);
        else if (Array.isArray(page)) candidates.push(...page);
      }
    } else if (Array.isArray(data)) {
      candidates.push(...data);
    } else if (data && typeof data === 'object') {
      // Discover payload: { forYou: { items }, college: { items }, ... }
      for (const section of Object.values(data)) {
        if (Array.isArray(section?.items)) candidates.push(...section.items);
      }
    }

    const hit = candidates.find((a) => a && wanted.has(String(a.id)));
    if (hit) return hit;
  }
  return undefined;
}

// ── Hooks ────────────────────────────────────────────────────────────────────

/**
 * Paginated crew activities with cursor-based infinite scrolling.
 * Hydrates from IndexedDB for instant first render.
 */
export function useActivities(scope = 'public', { enabled = true } = {}) {
  const queryClient = useQueryClient();
  const { isLoggedIn } = useAuth();

  // Each scope ('public' | 'for_you' | 'college' | 'one_on_one') gets its own
  // cache entry so the All, College and 1-on-1 lists never clobber one another.
  // A section's preview and the full list behind its "See all" share a key, so
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
 * Composed payload for the Crew "All" tab: the For You, college and 1-on-1
 * previews in one request, each capped and de-duplicated server-side. The full
 * lists behind each "See all" are served by useActivities(scope).
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
    forYou: query.data?.forYou || empty,
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

  const query = useQuery({
    queryKey: CREW_KEYS.byId(cleanId),
    queryFn: () => activitiesApi.getById(cleanId),
    enabled: !!cleanId,
    // Short freshness window rather than `staleTime: 0` + `refetchOnMount:
    // 'always'`. The card prefetches this exact entry on hover, and a
    // hover-to-click gap is well under a second, so re-firing on mount just
    // duplicated a request that had already landed. Anything that can actually
    // change membership — join/leave mutations and the activity's realtime
    // events — invalidates this key explicitly, so the window costs no
    // correctness.
    staleTime: 15_000,
    refetchOnMount: true,
    // 403/404 are final answers from the authorization boundary — retrying them
    // just repeats a denial. Everything else keeps the default retry behaviour.
    retry: (failureCount, error) => {
      const status = error?.status;
      if (status === 403 || status === 404) return false;
      return failureCount < 2;
    },
    // Seed the detail shell from whichever list the user actually came from, so
    // the page paints instantly instead of showing a spinner.
    //
    // This used to read only the public feed's cache entry. Every Crew section
    // now has its own cache key (for_you / college / one_on_one / discover), so
    // a card opened from any of them found nothing and fell back to a spinner.
    // Scanning every ['activities', ...] entry restores the fast path from all
    // of them. List entries are shape placeholders only — the query still
    // resolves the authoritative payload.
    placeholderData: () => findActivityInListCaches(queryClient, cleanId, id),
  });

  // The server is the only authority on access. Once it denies the request, any
  // locally cached copy of this activity — list card, placeholder, IndexedDB
  // rehydration — is dropped so nothing can keep rendering behind the
  // access-denied state.
  const denied = query.error?.status === 403 || query.error?.status === 404;
  useEffect(() => {
    if (!denied || !cleanId) return;
    queryClient.setQueryData(CREW_KEYS.byId(cleanId), undefined);
    // Drop the persisted feed page too: it may still hold a card for an
    // activity whose visibility has since been narrowed.
    idbDelete('activities', 'all_page1');
  }, [denied, cleanId, queryClient]);

  return {
    ...query,
    // `data` is force-cleared on denial: placeholderData would otherwise keep
    // serving the list-cache copy of a now-restricted activity.
    data: denied ? undefined : query.data,
    isAccessDenied: query.error?.status === 403,
    accessDeniedCode: query.error?.status === 403 ? query.error?.code || 'FORBIDDEN' : null,
    accessDeniedMessage: query.error?.status === 403 ? query.error?.message : null,
  };
}

/**
 * Reads an activity out of the client cache without ever fetching it.
 *
 * For places that already receive an activity payload and only want to enrich it
 * — a shared-activity card in a chat, for instance — where firing a request per
 * rendered item would be far worse than showing slightly thinner data.
 *
 * Subscribes to the detail cache (so it fills in live once the activity is
 * opened or prefetched) and falls back to a one-shot read of the list caches.
 */
export function useCachedActivity(id) {
  const queryClient = useQueryClient();
  const cleanId = id ? String(id).replace(/^(act_)+/, '') : id;

  // `enabled: false` means this never issues a request; it exists purely to
  // subscribe this component to that one cache entry.
  const { data: cachedDetail } = useQuery({
    queryKey: CREW_KEYS.byId(cleanId),
    queryFn: () => activitiesApi.getById(cleanId),
    enabled: false,
    staleTime: Infinity,
  });

  return useMemo(() => {
    if (!cleanId) return null;
    return cachedDetail || findActivityInListCaches(queryClient, cleanId, id) || null;
  }, [cleanId, id, cachedDetail, queryClient]);
}

/**
 * Attendees beyond the first page embedded in the detail payload.
 *
 * Disabled until the user actually asks for the full list, so opening an
 * activity never pays for attendees it will not show. Cursor-paginated, so
 * pages append cleanly and cannot duplicate or skip rows.
 */
export function useActivityAttendees(activityId, { enabled = false } = {}) {
  const cleanId = activityId ? String(activityId).replace(/^(act_)+/, '') : activityId;

  const query = useInfiniteQuery({
    queryKey: ['activity', cleanId, 'attendees'],
    queryFn: ({ pageParam }) => activitiesApi.getAttendees(cleanId, { cursor: pageParam }),
    enabled: Boolean(cleanId) && enabled,
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage?.nextCursor ?? undefined,
    staleTime: 30_000,
  });

  const attendees = useMemo(
    () => query.data?.pages?.flatMap((p) => p?.attendees ?? []).map((m) => m.user).filter(Boolean) ?? [],
    [query.data],
  );

  return {
    attendees,
    isLoading: query.isLoading,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: Boolean(query.hasNextPage),
    fetchNextPage: query.fetchNextPage,
    isError: query.isError,
  };
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

/**
 * The mapped activity list `useData` exposed as `crewActivities`.
 *
 * Extracted verbatim: the flat list from the infinite-query cache, run through
 * mapActivity, memoised on the raw list exactly as useData did. Kept here so
 * the five consumers that read `crewActivities` share one implementation
 * instead of each re-mapping every activity on every render.
 */
export function useCrewActivities() {
  const rawActivities = useActivitiesList();
  return useMemo(() => rawActivities.map(mapActivity), [rawActivities]);
}

/**
 * The activity write actions `useData` used to define inline.
 *
 * Extracted verbatim -- same activitiesApi calls, each followed by the same
 * ['activities'] invalidation. `endCrewActivity` remains an alias of
 * `cancelCrewActivity`, exactly as useData had it.
 */
export function useCrewActions() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['activities'] });

  const joinCrewActivity = (id) => activitiesApi.join(id).then(invalidate);
  const leaveCrewActivity = (id) => activitiesApi.leave(id).then(invalidate);
  const requestToJoinActivity = (id) => activitiesApi.requestToJoinActivity(id).then(invalidate);
  const cancelCrewActivity = (id) => activitiesApi.cancelCrewActivity(id).then(invalidate);
  const endCrewActivity = cancelCrewActivity;
  const acceptJoinRequest = (id, userId) => activitiesApi.acceptJoinRequest(id, userId).then(invalidate);
  const rejectJoinRequest = (id, userId) => activitiesApi.rejectJoinRequest(id, userId).then(invalidate);
  const declineCrewInvitation = (id) => activitiesApi.declineCrewInvitation(id).then(invalidate);
  const addCrewActivity = (data) => activitiesApi.create(data).then((res) => { invalidate(); return res; });

  return {
    joinCrewActivity,
    leaveCrewActivity,
    requestToJoinActivity,
    cancelCrewActivity,
    endCrewActivity,
    acceptJoinRequest,
    rejectJoinRequest,
    declineCrewInvitation,
    addCrewActivity,
  };
}
