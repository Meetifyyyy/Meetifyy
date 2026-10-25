/**
 * useConfessions — data hooks for anonymous campus Confessions.
 *
 * Everything here is campus-scoped by the server, which reads the campus from
 * the caller's affiliation (never from the request) and answers 403
 * `campus_affiliation_required` without one, exactly as the other campus
 * surfaces do; the queries hand that error to `useCampusDeniedHandler`.
 *
 * Anonymity is the server's job: no response carries who is behind a handle.
 * The client never sends or caches a real identity alongside a confession.
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { confessionsApi } from '@shared/api/apiClient';
import { useAuth } from '@shared/context/AuthContext';
import { useHasCampusAccess, useCampusDeniedHandler } from './useCampusAffiliation';
import { useGuardedMutation } from './useGuardedMutation';
import { validateHandle } from '@shared/lib/confessionHandle';

export const CONFESSION_KEYS = {
  all: ['confessions'],
  me: ['confessions', 'me'],
  feed: ['confessions', 'feed'],
  handle: (key) => ['confessions', 'handle', key],
};

/**
 * Whether this account has an anonymous name, remembered on the device so the
 * page can open on the right screen at once instead of behind a spinner while
 * `GET /confessions/me` answers.
 *
 * Only a yes/no, per account id — never the name itself: the device must not
 * hold a mapping from an account to the handle it hides behind. The server's
 * answer always replaces it.
 */
const HAS_PROFILE_PREFIX = 'meetifyy:confessions:has-profile';
const hasProfileKey = (userId) => `${HAS_PROFILE_PREFIX}:${userId}`;

/** `true` / `false` as last seen on this device, or `undefined` if never seen. */
export function readHasProfileHint(userId) {
  if (!userId) return undefined;
  try {
    const v = window.localStorage.getItem(hasProfileKey(userId));
    return v === '1' ? true : v === '0' ? false : undefined;
  } catch {
    return undefined;
  }
}

function writeHasProfileHint(userId, has) {
  if (!userId) return;
  try {
    window.localStorage.setItem(hasProfileKey(userId), has ? '1' : '0');
  } catch {
    // Storage blocked: the next visit simply waits for the server again.
  }
}

/**
 * How long an answer from `GET /confessions/me` stands. A profile is created
 * once and never renamed, so "has one" never goes stale. "Has none" stands
 * only briefly: it stops being true the moment a name is chosen on another
 * device, and the onboarding must never be shown to someone who already
 * finished it. Brief, rather than none, so the answer Campus fetched on the
 * way in is the one the page opens with instead of being asked for again.
 */
const NO_PROFILE_FRESH_MS = 30_000;
const profileStaleTime = (query) => (query.state.data?.profile ? Infinity : NO_PROFILE_FRESH_MS);

const fetchMe = () => confessionsApi.getMe();
const fetchFeedPage = ({ pageParam }) => confessionsApi.list({ cursor: pageParam });
const feedNextPage = (last) => last?.nextCursor ?? undefined;
const FEED_STALE_TIME = 30_000;

/**
 * The caller's anonymous profile: `undefined` until known, `null` if none yet.
 *
 * `hint` is the device's last-known answer (see readHasProfileHint), for
 * opening on the feed before the server has replied. `confirmedNone` is true
 * only on a fresh "no profile" from the server (fetched for this visit, or in
 * the last few seconds): an older cached "none" is not enough to show the
 * onboarding, because the name may have been chosen elsewhere since.
 */
export function useConfessionProfile() {
  const { isLoggedIn, currentUser } = useAuth();
  const userId = currentUser?.id;
  const hasAccess = useHasCampusAccess();
  const onDenied = useCampusDeniedHandler();
  const query = useQuery({
    queryKey: CONFESSION_KEYS.me,
    queryFn: () =>
      fetchMe().catch((err) => {
        onDenied(err);
        throw err;
      }),
    enabled: Boolean(isLoggedIn) && hasAccess,
    staleTime: profileStaleTime,
  });
  const profile = query.data ? query.data.profile ?? null : undefined;
  useEffect(() => {
    if (profile !== undefined) writeHasProfileHint(userId, Boolean(profile));
  }, [profile, userId]);
  // Per account, and read again if the account arrives after the first render.
  const hint = useMemo(() => readHasProfileHint(userId), [userId]);
  // Once confirmed, it stays confirmed for this visit: a background refetch
  // (the window regaining focus once the answer has aged) must not swap the
  // name screen for the loading frame under someone's fingers and lose what
  // they typed. A refetch that finds a profile still wins, via `profile`.
  const freshNone = profile === null && (query.isFetchedAfterMount || !query.isStale);
  const [noneSeen, setNoneSeen] = useState(false);
  if (freshNone && !noneSeen) setNoneSeen(true);
  return {
    profile,
    hint,
    confirmedNone: profile === null && (freshNone || noneSeen),
    isError: query.isError,
    refetch: query.refetch,
  };
}

/**
 * Warms what the Confessions page opens with, so the tap from Campus lands on
 * a finished screen. `profile` asks who the caller is there (one request, and
 * none at all once a profile is cached); `feed` also loads the first page,
 * which is worth it only on the way in. Both share the hooks' cache keys and
 * freshness rules, so nothing is fetched twice.
 */
export function usePrefetchConfessions() {
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();
  const userId = currentUser?.id;
  return useCallback(({ feed = false } = {}) => {
    queryClient.prefetchQuery({ queryKey: CONFESSION_KEYS.me, queryFn: fetchMe, staleTime: profileStaleTime });
    const cached = queryClient.getQueryData(CONFESSION_KEYS.me);
    const hasProfile = cached ? Boolean(cached.profile) : readHasProfileHint(userId) === true;
    if (feed && hasProfile) {
      queryClient.prefetchInfiniteQuery({
        queryKey: CONFESSION_KEYS.feed,
        queryFn: fetchFeedPage,
        initialPageParam: undefined,
        getNextPageParam: feedNextPage,
        staleTime: FEED_STALE_TIME,
      });
    }
  }, [queryClient, userId]);
}

/**
 * Live availability for a handle being typed.
 *
 * The local rules are checked first and synchronously, so an obviously bad
 * value never costs a request; only a well-formed one is debounced and asked
 * about. The server re-checks everything on create — this is feedback, not
 * the gate.
 *
 * Returns `{ state, reason }`, state one of:
 *   'empty' | 'invalid' | 'checking' | 'available' | 'taken' | 'reserved' | 'limited' | 'error'
 */
export function useHandleAvailability(handle, { delay = 350 } = {}) {
  const local = validateHandle(handle);
  const key = local.ok ? handle.trim().toLowerCase() : '';
  const [debounced, setDebounced] = useState(key);

  useEffect(() => {
    if (!key) {
      setDebounced('');
      return undefined;
    }
    const t = setTimeout(() => setDebounced(key), delay);
    return () => clearTimeout(t);
  }, [key, delay]);

  const query = useQuery({
    queryKey: CONFESSION_KEYS.handle(debounced),
    queryFn: ({ signal }) => confessionsApi.checkHandle(debounced, { signal }),
    enabled: Boolean(debounced),
    staleTime: 15_000,
    retry: false,
  });

  return useMemo(() => {
    if (!handle || !handle.trim()) return { state: 'empty', reason: null };
    if (!local.ok) return { state: 'invalid', reason: local.reason };
    if (debounced !== key || query.isFetching) return { state: 'checking', reason: null };
    if (query.isError) {
      return { state: query.error?.status === 429 ? 'limited' : 'error', reason: null };
    }
    const data = query.data;
    if (!data) return { state: 'checking', reason: null };
    if (data.available) return { state: 'available', reason: null };
    if (data.reason === 'reserved') return { state: 'reserved', reason: null };
    if (data.reason === 'invalid') return { state: 'invalid', reason: 'server' };
    return { state: 'taken', reason: null };
  }, [handle, local.ok, local.reason, debounced, key, query.isFetching, query.isError, query.error, query.data]);
}

export function useCreateConfessionProfile() {
  const queryClient = useQueryClient();
  return useGuardedMutation(
    useMutation({
      mutationFn: (handle) => confessionsApi.createProfile(handle),
      onSuccess: (data) => {
        queryClient.setQueryData(CONFESSION_KEYS.me, { profile: data?.profile ?? null });
      },
    }),
  );
}

/** The campus feed, newest first, a page at a time. */
export function useConfessionsFeed({ enabled = true } = {}) {
  const { isLoggedIn } = useAuth();
  const hasAccess = useHasCampusAccess();
  const onDenied = useCampusDeniedHandler();
  const query = useInfiniteQuery({
    queryKey: CONFESSION_KEYS.feed,
    queryFn: (ctx) =>
      fetchFeedPage(ctx).catch((err) => {
        onDenied(err);
        throw err;
      }),
    enabled: Boolean(isLoggedIn) && hasAccess && enabled,
    initialPageParam: undefined,
    getNextPageParam: feedNextPage,
    staleTime: FEED_STALE_TIME,
  });

  const confessions = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const page of query.data?.pages ?? []) {
      for (const c of Array.isArray(page?.confessions) ? page.confessions : []) {
        // A confession posted while paging shifts the cursor window by one;
        // never show the same card twice.
        if (!c?.id || seen.has(c.id)) continue;
        seen.add(c.id);
        out.push(c);
      }
    }
    return out;
  }, [query.data]);

  return {
    confessions,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    isRefetching: query.isRefetching,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: query.fetchNextPage,
  };
}

/** Apply `fn` to the one cached confession with `id`, in every loaded page. */
function patchFeed(queryClient, id, fn) {
  queryClient.setQueryData(CONFESSION_KEYS.feed, (data) => {
    if (!data?.pages) return data;
    return {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        confessions: (page?.confessions ?? []).map((c) => (c.id === id ? fn(c) : c)),
      })),
    };
  });
}

export function useCreateConfession() {
  const queryClient = useQueryClient();
  return useGuardedMutation(
    useMutation({
      mutationFn: (content) => confessionsApi.create(content),
      onSuccess: (data) => {
        const created = data?.confession;
        if (!created) return;
        // Straight to the top of the first page: no refetch, no flash.
        queryClient.setQueryData(CONFESSION_KEYS.feed, (old) => {
          if (!old?.pages?.length) return old;
          const [first, ...rest] = old.pages;
          return {
            ...old,
            pages: [{ ...first, confessions: [created, ...(first?.confessions ?? [])] }, ...rest],
          };
        });
      },
    }),
  );
}

/**
 * Relate / un-relate, applied optimistically and rolled back on failure; the
 * server's counts replace the guess when it answers.
 */
export function useRelateConfession() {
  const queryClient = useQueryClient();
  return useGuardedMutation(
    useMutation({
      mutationFn: ({ id, relate }) => (relate ? confessionsApi.relate(id) : confessionsApi.unrelate(id)),
      onMutate: async ({ id, relate }) => {
        await queryClient.cancelQueries({ queryKey: CONFESSION_KEYS.feed });
        const previous = queryClient.getQueryData(CONFESSION_KEYS.feed);
        patchFeed(queryClient, id, (c) => ({
          ...c,
          relatedByMe: relate,
          relateCount: Math.max(0, (c.relateCount ?? 0) + (relate === c.relatedByMe ? 0 : relate ? 1 : -1)),
        }));
        return { previous };
      },
      onError: (_err, _vars, ctx) => {
        if (ctx?.previous) queryClient.setQueryData(CONFESSION_KEYS.feed, ctx.previous);
      },
      onSuccess: (data, { id }) => {
        if (!data || typeof data.relateCount !== 'number') return;
        patchFeed(queryClient, id, (c) => ({ ...c, relateCount: data.relateCount, relatedByMe: Boolean(data.relatedByMe) }));
      },
    }),
  );
}

export function useDeleteConfession() {
  const queryClient = useQueryClient();
  return useGuardedMutation(
    useMutation({
      mutationFn: (id) => confessionsApi.remove(id),
      onSuccess: (_data, id) => {
        queryClient.setQueryData(CONFESSION_KEYS.feed, (data) => {
          if (!data?.pages) return data;
          return {
            ...data,
            pages: data.pages.map((p) => ({ ...p, confessions: (p?.confessions ?? []).filter((c) => c.id !== id) })),
          };
        });
      },
    }),
  );
}
