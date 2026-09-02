/**
 * useCommunities — feature-scoped hook for community data.
 *
 * Owns the query keys, caching policy, and invalidation for communities.
 * Replaces the communities queries that useData() previously fired unconditionally.
 * Uses IndexedDB for cross-session persistence so the community list appears instantly
 * on next visit before the network response arrives.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { communitiesApi } from '@shared/api/apiClient';
import { idbGet, idbSet, idbDelete } from '@shared/lib/idb';
import { useAuth } from '@shared/context/AuthContext';

// ── Query keys ───────────────────────────────────────────────────────────────
export const COMMUNITY_KEYS = {
  all:    ['communities'],
  campus: ['communities', 'campus'],
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
          queryClient.setQueryData(queryKey, cached.value);
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
    rawCommunities: query.data || [],
    isLoading: query.isLoading,
    isError: query.isError,
  };
}

/**
 * Fetches communities belonging to the current user's campus.
 */
export function useCampusCommunities(search = '') {
  const normSearch = (search || '').trim();
  // Filtered searches are cached under their own key; only the unfiltered list
  // is IDB-hydrated for instant first paint.
  const qk = normSearch ? [...COMMUNITY_KEYS.campus, { search: normSearch }] : COMMUNITY_KEYS.campus;
  const { isLoggedIn } = useAuth();

  const query = useQuery({
    queryKey: qk,
    queryFn: async () => {
      const data = await communitiesApi.getCampusCommunities(normSearch || undefined);
      if (!normSearch) idbSet('communities', 'campus', data);
      return data;
    },
    enabled: isLoggedIn,
    staleTime: normSearch ? 60 * 1000 : 10 * 60 * 1000,
    gcTime:    30 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  const queryClient = useQueryClient();
  useEffect(() => {
    if (normSearch || query.data) return;
    hydrateFromIdb(queryClient, 'campus', COMMUNITY_KEYS.campus);
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
