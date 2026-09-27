/**
 * useCommunities — feature-scoped hook for community data.
 *
 * Owns the query keys, caching policy, and invalidation for communities.
 * Replaces the communities queries that useData() previously fired unconditionally.
 * Uses IndexedDB for cross-session persistence so the community list appears instantly
 * on next visit before the network response arrives.
 */
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';
import { communitiesApi } from '@shared/api/apiClient';
import { idbGet, idbSet, idbDelete } from '@shared/lib/idb';
import { useAuth } from '@shared/context/AuthContext';
import { toggleRegistry } from '@shared/utils/mutationRegistry';

// A stable empty list. `query.data || []` handed every consumer a brand-new
// array on each render, which re-ran every `useMemo` keyed on it — including
// the joined-communities derivation the header and sidebar both run.
const EMPTY_COMMUNITIES = [];

// ── Query keys ───────────────────────────────────────────────────────────────
export const COMMUNITY_KEYS = {
  all:    ['communities'],
  campus: ['communities', 'campus'],
  mine:   ['communities', 'mine'],
  explore: (filters) => ['communities', 'explore', filters],
  // Nested under `all` deliberately: the join mutation updates every entry
  // under the ['communities'] prefix in one pass, so a new list added here is
  // kept in sync by construction rather than by remembering to add it.
  recommendations: (limit) => ['communities', 'recommendations', { limit }],
  byId:   (id) => ['community', id],
};

/**
 * The de-duplicated list and the id lookup, derived once per API response.
 *
 * These were two `useMemo`s inside the hook, so every caller kept its own copy
 * and rebuilt both whenever the community list changed. The hook is called by
 * every post card on screen and every node in a comment thread, so a single
 * refresh of the community list rebuilt the same map dozens of times over and
 * handed each consumer a *different* object — which then failed the identity
 * check of anything memoising downstream of it.
 *
 * A WeakMap keyed on the response array gives everyone the same two values and
 * lets them be collected with it.
 *
 * The list is de-duplicated by id deliberately. It used to be a hybrid array
 * that ALSO had each community assigned onto it under its own id
 * (`arr[c.id] = c`), so `Object.values()` returned every community twice — once
 * for its numeric index and once for its id key — which is what made the
 * Discover Communities card render each entry twice. The two access patterns
 * are separate values now, so neither can corrupt the other.
 */
const derivedCache = new WeakMap();
const EMPTY_DERIVED = Object.freeze({ communities: Object.freeze([]), communitiesById: Object.freeze({}) });

function deriveCommunities(data) {
  if (!Array.isArray(data)) return EMPTY_DERIVED;
  const cached = derivedCache.get(data);
  if (cached) return cached;

  const byId = new Map();
  for (const c of data) {
    if (c && typeof c === 'object' && c.id) byId.set(c.id, c);
  }
  const communities = Array.from(byId.values());
  const communitiesById = {};
  for (const c of communities) communitiesById[c.id] = c;

  const derived = { communities, communitiesById };
  derivedCache.set(data, derived);
  return derived;
}

/**
 * One IndexedDB read per cache entry, however many components ask for it.
 *
 * Cleared once it resolves so a later mount (after the entry was invalidated
 * and dropped) can hydrate again rather than replaying a stale promise.
 */
const idbHydrations = new Map();

function hydrateFromIdb(queryClient, idbKey, queryKey) {
  let pending = idbHydrations.get(idbKey);
  if (!pending) {
    pending = idbGet('communities', idbKey)
      .then((cached) => {
        // Only seed a cache that is still empty: a network response that landed
        // while this read was in flight is newer than what IndexedDB holds.
        if (cached?.value && queryClient.getQueryData(queryKey) === undefined) {
          // `updatedAt: 0` backdates the seed so the query counts as STALE the
          // instant it is written.
          //
          // Without it, `setQueryData` stamps the entry with the current time
          // and the query's five-minute `staleTime` then suppressed the
          // revalidating fetch entirely. The mirror is written from a previous
          // session, and it carries per-viewer membership (`isJoined`,
          // `userRole`) — so a reload after joining a community restored the
          // pre-join rows and showed "Join" again, for five minutes, with no
          // request made that could have corrected it. That is the
          // "refreshing produces a different membership state" report.
          //
          // Backdated, the seed still paints instantly and the network fetch
          // still runs, so the stale membership is corrected in one round trip.
          queryClient.setQueryData(queryKey, cached.value, { updatedAt: 0 });
        }
      })
      .catch(() => {})
      .finally(() => idbHydrations.delete(idbKey));
    idbHydrations.set(idbKey, pending);
  }
  return pending;
}

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

  // Hydrate from IndexedDB before first network response.
  //
  // Deduped across hook instances. This hook is called by every <Post> on
  // screen and every <CommentNode> in a thread — 60+ callers on a busy post —
  // and each one used to fire its own `idbGet` on mount, so a cold open queued
  // dozens of identical IndexedDB reads for one cache entry. The shared promise
  // means one read, whoever asks first, with the rest awaiting the same result.
  const queryClient = useQueryClient();
  useEffect(() => {
    if (query.data) return;
    hydrateFromIdb(queryClient, 'all', qk);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A plain, de-duplicated array.
  //
  // This used to be a hybrid: an array that ALSO had each community assigned
  // onto it under its own id (`arr[c.id] = c`), so it could be read both as a
  // list and as a lookup map. The cost was that `Object.values()` returned every
  // community TWICE — once for its numeric index and once for its id key — which
  // is what made the Discover Communities card render each entry twice.
  //
  // The two access patterns are now separate values, so neither can corrupt the
  // other. The id de-duplication is belt-and-braces: it guarantees the list is
  // unique even if a future endpoint or an optimistic update ever emits a
  // repeated row.
  // Derived once per distinct API response and shared by every caller — see
  // deriveCommunities. Both values keep their identity as long as the
  // underlying data does, so a consumer that memoises on them stays memoised.
  const { communities, communitiesById } = deriveCommunities(query.data);

  return {
    communities,
    communitiesById,
    // The de-duplicated list, not `query.data || []`. The fallback allocated a
    // new empty array on every render while the query was still loading, which
    // is a changed dependency for anything memoising on it downstream.
    rawCommunities: communities,
    isLoading: query.isLoading,
    isError: query.isError,
    // CommunitiesBrowse has always destructured `refetch` from this hook and
    // handed it to <ErrorState onRetry>, but the hook never returned one — so
    // the retry button on a failed community list did nothing at all.
    refetch: query.refetch,
  };
}

/**
 * Fetches communities belonging to the current user's campus.
 *
 * The request is skipped for an account with no college. `GET
 * /communities/campus` resolves the caller's `collegeId` and returns `[]` the
 * moment it finds none, so for those users the call could only ever answer
 * with an empty list — and it was being made on every app boot, from the
 * always-mounted layout, before anything campus-shaped was even on screen.
 * Skipping it is therefore invisible: the value the hook returns is the same
 * `[]` either way.
 *
 * Note the gate is *college membership*, not verification. The endpoint is not
 * verification-gated, and an account whose verification was revoked can still
 * be a member of campus communities it joined while verified — those have to
 * keep appearing in the sidebar's joined list.
 */
export function useCampusCommunities(search = '', { enabled = true } = {}) {
  const normSearch = (search || '').trim();
  // Filtered searches are cached under their own key; only the unfiltered list
  // is IDB-hydrated for instant first paint.
  const qk = normSearch ? [...COMMUNITY_KEYS.campus, { search: normSearch }] : COMMUNITY_KEYS.campus;
  const { isLoggedIn, currentUser } = useAuth();
  const hasCollege = Boolean(currentUser?.collegeId);
  const isEnabled = Boolean(isLoggedIn) && hasCollege && enabled;

  const query = useQuery({
    queryKey: qk,
    queryFn: async () => {
      const data = await communitiesApi.getCampusCommunities(normSearch || undefined);
      if (!normSearch) idbSet('communities', 'campus', data);
      return data;
    },
    enabled: isEnabled,
    staleTime: normSearch ? 60 * 1000 : 10 * 60 * 1000,
    gcTime:    30 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  const queryClient = useQueryClient();
  useEffect(() => {
    // The IndexedDB mirror outlives the session, so restoring it for an account
    // the live query is not allowed to make would put campus data back into the
    // cache with no request the server could refuse.
    if (!isEnabled || normSearch || query.data) return;
    hydrateFromIdb(queryClient, 'campus', COMMUNITY_KEYS.campus);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEnabled]);

  return {
    campusCommunities: query.data || EMPTY_COMMUNITIES,
    isLoading: query.isLoading,
  };
}

/**
 * The communities this account belongs to — public, private and campus — from
 * `GET /communities/mine`, most recently joined first.
 *
 * This used to be derived by filtering the first page of the public list (the
 * thirty largest communities) and the campus list for membership, so a member
 * of anything smaller, or of a private community, never saw it listed. The
 * server answers the membership question directly now.
 *
 * An in-flight leave outranks the cached row, so a community disappears from
 * every list the moment the viewer leaves it rather than after the refetch.
 */
export function useMyCommunities({ enabled = true } = {}) {
  const { isLoggedIn } = useAuth();
  const query = useQuery({
    queryKey: COMMUNITY_KEYS.mine,
    queryFn: communitiesApi.getMine,
    enabled: Boolean(isLoggedIn) && enabled,
    staleTime: 2 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });

  const data = query.data;
  const myCommunities = useMemo(() => {
    if (!Array.isArray(data)) return EMPTY_COMMUNITIES;
    return data.filter((c) => toggleRegistry.getLatestIntent(`joinCommunity:${c.id}`, c.isJoined !== false));
  }, [data]);

  return {
    myCommunities,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}

/**
 * One filtered view of the discovery list, paged by offset.
 *
 * Search runs on the server: the list is paged,
 * so filtering a page on the client would return short pages and miss every
 * match beyond the first thirty.
 */
export const EXPLORE_PAGE_SIZE = 30;

export function useExploreCommunities({ search = '' } = {}) {
  const { isLoggedIn } = useAuth();
  const q = search.trim();
  const query = useInfiniteQuery({
    queryKey: COMMUNITY_KEYS.explore({ search: q }),
    queryFn: ({ pageParam = 0 }) =>
      communitiesApi.explore({
        search: q || undefined,
        limit: EXPLORE_PAGE_SIZE,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) =>
      Array.isArray(lastPage) && lastPage.length === EXPLORE_PAGE_SIZE
        ? pages.length * EXPLORE_PAGE_SIZE
        : undefined,
    enabled: Boolean(isLoggedIn),
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
    // Keeps the current results on screen while a new search is fetched, so
    // typing does not flash the list empty on every debounce.
    placeholderData: (prev) => prev,
  });

  const pages = query.data?.pages;
  const communities = useMemo(() => {
    if (!pages) return EMPTY_COMMUNITIES;
    const seen = new Set();
    const out = [];
    for (const page of pages) {
      if (!Array.isArray(page)) continue;
      for (const c of page) {
        if (c?.id && !seen.has(c.id)) {
          seen.add(c.id);
          out.push(c);
        }
      }
    }
    return out;
  }, [pages]);

  return {
    communities,
    isLoading: query.isLoading,
    isError: query.isError,
    isFetching: query.isFetching,
    isPlaceholderData: query.isPlaceholderData,
    hasNextPage: Boolean(query.hasNextPage),
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: query.fetchNextPage,
    refetch: query.refetch,
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
    retry: (failureCount, error) => {
      const status = error?.response?.status;
      const msg = error?.response?.data?.message || error?.message;
      if (status === 404 || msg === 'COMMUNITY_DELETED' || msg === 'COMMUNITY_NOT_FOUND') {
        return false;
      }
      return failureCount < 2;
    },
    // No keep-previous here: the key IS the identity. Opening community B
    // rendered community A's name, description and avatar until B's fetch
    // landed, which read as "the community avatar loaded the wrong image".
  });
}

// ── Mutations ────────────────────────────────────────────────────────────────

/**
 * Everything a community write has to touch, in one place.
 *
 * `COMMUNITY_KEYS.byId` is a different root from `COMMUNITY_KEYS.all`, so
 * invalidating the list left an open community page showing the pre-join member
 * count and Join button. And the list is mirrored into IndexedDB for instant
 * first paint, so without dropping that mirror the next session rehydrated the
 * state from before the write — the "it's stale again after I reopen the app"
 * case, which no amount of query invalidation fixes.
 */
function invalidateCommunity(queryClient, id) {
  queryClient.invalidateQueries({ queryKey: COMMUNITY_KEYS.all });
  if (id) queryClient.invalidateQueries({ queryKey: COMMUNITY_KEYS.byId(id) });
  idbDelete('communities', 'all').catch(() => {});
  idbDelete('communities', 'campus').catch(() => {});
}

export function useJoinCommunity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => communitiesApi.join(id),
    onSuccess: (_data, id) => invalidateCommunity(queryClient, id),
  });
}

export function useLeaveCommunity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => communitiesApi.leave(id),
    onSuccess: (_data, id) => invalidateCommunity(queryClient, id),
  });
}

export function useCreateCommunity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => communitiesApi.create(data),
    onSuccess: (created) => invalidateCommunity(queryClient, created?.id),
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
