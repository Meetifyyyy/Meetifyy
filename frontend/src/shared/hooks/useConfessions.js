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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { confessionsApi } from '@shared/api/apiClient';
import { useAuth } from '@shared/context/AuthContext';
import { useHasCampusAccess, useCampusDeniedHandler } from './useCampusAffiliation';
import { useGuardedMutation } from './useGuardedMutation';
import { validateHandle } from '@shared/lib/confessionHandle';
import { reactionStateOf, withReaction } from '@shared/lib/confessionReactions';
import { isOnline } from '@shared/lib/networkStatus';
import { blockIfOffline, OfflineError } from '@shared/lib/offlineGuard';
import { useGlobalSocketStore } from '@shared/stores/useGlobalSocketStore';

export const CONFESSION_KEYS = {
  all: ['confessions'],
  me: ['confessions', 'me'],
  feed: ['confessions', 'feed'],
  handle: (key) => ['confessions', 'handle', key],
  one: (id) => ['confessions', 'one', id],
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
/**
 * The loaded feed never goes stale by the clock: re-downloading every loaded
 * page on each visit is what this replaces. It is kept current instead by
 * live reaction totals while the page is open and, when it is opened again,
 * by one `sync` request (see useConfessionsLive).
 */
const FEED_STALE_TIME = Infinity;

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
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
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

/** Apply `fn` to every cached copy of confession `id`: the feed and its own. */
function patchConfession(queryClient, id, fn) {
  patchFeed(queryClient, id, fn);
  queryClient.setQueryData(CONFESSION_KEYS.one(id), (data) =>
    (data?.confession ? { ...data, confession: fn(data.confession) } : data));
}

/** The cached copy of confession `id`, from wherever one is held. */
function cachedConfession(queryClient, id) {
  const one = queryClient.getQueryData(CONFESSION_KEYS.one(id))?.confession;
  if (one) return one;
  for (const page of queryClient.getQueryData(CONFESSION_KEYS.feed)?.pages ?? []) {
    const hit = (page?.confessions ?? []).find((c) => c.id === id);
    if (hit) return hit;
  }
  return null;
}

/** Drop confession `id` from every cache: it is gone or no longer ours to see. */
function forgetConfession(queryClient, id) {
  queryClient.setQueryData(CONFESSION_KEYS.feed, (data) => {
    if (!data?.pages) return data;
    return {
      ...data,
      pages: data.pages.map((p) => ({ ...p, confessions: (p?.confessions ?? []).filter((c) => c.id !== id) })),
    };
  });
  queryClient.invalidateQueries({ queryKey: CONFESSION_KEYS.one(id) });
}

/** 403/404: the confession is not there for this viewer (deleted, hidden, removed, other campus). */
export const isConfessionGone = (err) => err?.status === 404 || err?.status === 403;

/**
 * One confession by id, for a card shared into a chat or a link to it. Asked
 * of the server every time it is shown (and kept briefly), never taken from
 * the message: the server decides, for this viewer now, whether it may be
 * read at all. A 404/403 is final and not retried.
 *
 * Deliberately does not hand a 403 to the campus-denied handler: a chat card
 * for somebody without campus access is simply unavailable, not a redirect.
 */
export function useConfession(id, { enabled = true } = {}) {
  const { isLoggedIn } = useAuth();
  const query = useQuery({
    queryKey: CONFESSION_KEYS.one(id),
    queryFn: ({ signal }) => confessionsApi.get(id, { signal }),
    enabled: Boolean(isLoggedIn) && Boolean(id) && enabled,
    staleTime: 30_000,
    retry: (count, err) => !isConfessionGone(err) && count < 2,
    retryDelay: (attempt) => Math.min(500 * 2 ** attempt, 4000),
  });
  return {
    confession: query.data?.confession ?? null,
    isLoading: query.isLoading,
    isGone: query.isError && isConfessionGone(query.error),
    isError: query.isError && !isConfessionGone(query.error),
    refetch: query.refetch,
  };
}

/**
 * How long a tap waits for the next one before it is sent. Long enough to
 * fold a burst (tapping through the picker, a double tap) into one request,
 * short enough that nobody notices: the screen changed on the tap itself.
 */
export const REACTION_SEND_DELAY_MS = 250;

/**
 * Whether a cache event is a fetch of `key` finishing, either way. A
 * `setQueryData` also reports `success`, flagged `manual`; that is a write
 * made here, not the fetch.
 */
const fetchSettled = (event, key) =>
  event?.type === 'updated' &&
  ((event.action?.type === 'success' && !event.action.manual) || event.action?.type === 'error') &&
  JSON.stringify(event.query?.queryKey) === JSON.stringify(key);

/**
 * Setting, changing and removing your reaction.
 *
 * Every tap shows at once (optimistically, in every cached copy). The network
 * sees far less than the screen does:
 *
 *   - Taps are folded together: a request goes REACTION_SEND_DELAY_MS after
 *     the last tap, carrying only where the taps ended up.
 *   - Nothing is sent when that is where the server already is (Love, then
 *     Love again to take it back).
 *   - One request per confession at a time. Taps made while one is in flight
 *     wait for it and are sent as one, so two requests never race to decide
 *     what the server ends on.
 *
 * If the last request fails, the card returns to what the server last
 * confirmed; a confession that has gone (404) leaves the feed. A feed or
 * confession fetch that was already on its way when you tapped can land
 * afterwards with the older answer, so the confirmed state is put back once
 * it does.
 *
 * Returns `react(id, next, { onError })`, `next` a reaction key or null.
 */
/**
 * Reaction requests per confession id, waiting or in flight. Module-level so
 * the live updates and the sync below can tell a confession whose totals are
 * about to be settled by the caller's own request, and leave it alone.
 */
const reactionQueues = new Map();

export function useConfessionReactions() {
  const queryClient = useQueryClient();
  const queues = useRef(reactionQueues);

  /** Put `state` back over whatever a fetch already in flight brings. */
  const holdAgainstStaleFetches = useCallback((id, state) => {
    const keys = [CONFESSION_KEYS.feed, CONFESSION_KEYS.one(id)]
      .filter((queryKey) => queryClient.isFetching({ queryKey, exact: true }) > 0);
    if (keys.length === 0) return;
    const cache = queryClient.getQueryCache();
    const unsubscribe = cache.subscribe((event) => {
      const at = keys.findIndex((key) => fetchSettled(event, key));
      if (at === -1) return;
      keys.splice(at, 1);
      // Only while nothing newer has been tapped for this confession.
      if (!queues.current.has(id)) patchConfession(queryClient, id, (c) => ({ ...c, ...state }));
      if (keys.length === 0) unsubscribe();
    });
  }, [queryClient]);

  const send = useCallback(async (id) => {
    const q = queues.current.get(id);
    if (!q || q.inFlight || q.want === undefined) return;
    clearTimeout(q.timer);
    q.timer = null;
    const want = q.want;
    q.want = undefined;

    let failure = null;
    if (want !== q.confirmed.myReaction) {
      q.inFlight = true;
      try {
        const state = want ? await confessionsApi.react(id, want) : await confessionsApi.unreact(id);
        q.confirmed = reactionStateOf(state);
      } catch (err) {
        failure = err;
      }
      q.inFlight = false;
    }
    if (q.want !== undefined) {
      // Tapped again meanwhile: the screen already shows that; send it now
      // rather than after another delay, it has waited for this request.
      void send(id); // not awaited: its own outcome settles the queue
      return;
    }
    queues.current.delete(id);
    if (failure?.status === 404) {
      forgetConfession(queryClient, id);
    } else {
      patchConfession(queryClient, id, (c) => ({ ...c, ...q.confirmed }));
      holdAgainstStaleFetches(id, q.confirmed);
    }
    if (failure) q.onError?.(failure);
  }, [queryClient, holdAgainstStaleFetches]);

  // Taps still waiting out the delay go at once when the page is hidden
  // (app switched away, tab closed), instead of being lost with it.
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState !== 'hidden') return;
      for (const [id, q] of queues.current) {
        if (q.timer) void send(id); // not awaited: fire before the page goes
      }
    };
    document.addEventListener('visibilitychange', flush);
    return () => document.removeEventListener('visibilitychange', flush);
  }, [send]);

  return useCallback((id, next, { onError } = {}) => {
    if (!id) return;
    if (!isOnline()) {
      blockIfOffline('action');
      onError?.(new OfflineError('action'));
      return;
    }
    let q = queues.current.get(id);
    if (!q) {
      const current = cachedConfession(queryClient, id);
      q = { inFlight: false, want: undefined, timer: null, confirmed: reactionStateOf(current) };
      queues.current.set(id, q);
    }
    q.want = next ?? null;
    q.onError = onError;
    // Not cancelling the feed query here: an in-flight page refetch would
    // be dropped. `holdAgainstStaleFetches` deals with its answer instead.
    patchConfession(queryClient, id, (c) => ({ ...c, ...withReaction(c, next ?? null) }));
    if (q.inFlight) return; // sent when the request in flight lands
    clearTimeout(q.timer);
    q.timer = setTimeout(() => { void send(id); }, REACTION_SEND_DELAY_MS); // not awaited: progress shows through the cache
  }, [queryClient, send]);
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
      // Its own copy too, so a card shared into a chat stops showing it.
      onSuccess: (_data, id) => forgetConfession(queryClient, id),
    }),
  );
}

// ── Live totals and catching up ──────────────────────────────────────────

/** Feed cursor of the newest confession held: the server's `createdAt|id`. */
const cursorOf = (c) => (c?.createdAt && c?.id ? `${c.createdAt}|${c.id}` : undefined);
/** Most ids a sync refreshes: the server's limit (SYNC_MAX_IDS). */
const SYNC_MAX_IDS = 100;
/** A sync at most this often, however the page is reopened or refocused. */
const SYNC_MIN_GAP_MS = 10_000;
/** Back after at least this long hidden: worth asking what changed. */
const AWAY_MS = 15_000;
let lastSyncAt = 0;
/** Newest live update applied per confession, so an older one never wins. */
const liveAt = new Map();

/** Totals from the server, with the caller's own choice kept as it is. */
function withTotals(c, reactions, reactionCount) {
  // A count of zero for the kind the caller holds means it was taken back
  // elsewhere (another device): believe the server.
  const mine = c.myReaction && reactions[c.myReaction] > 0 ? c.myReaction : null;
  return {
    ...c,
    reactions,
    reactionCount,
    relateCount: reactionCount,
    myReaction: mine,
    relatedByMe: mine !== null,
  };
}

/** Applies one `confession.reactions` event. Exported for tests. */
export function applyLiveReactions(queryClient, data) {
  const id = data?.confessionId;
  if (!id || !data.reactions || typeof data.reactionCount !== 'number') return;
  // The caller's own request will settle this one with its answer.
  if (reactionQueues.has(id)) return;
  const at = Number(data.at) || 0;
  if (at && at < (liveAt.get(id) ?? 0)) return;
  if (at) liveAt.set(id, at);
  patchConfession(queryClient, id, (c) => withTotals(c, data.reactions, data.reactionCount));
}

/** Applies a sync answer to the cached feed. Exported for tests. */
export function applySync(queryClient, result) {
  const gone = new Set(result?.gone ?? []);
  const states = result?.states ?? {};
  const newer = Array.isArray(result?.newer) ? result.newer : [];
  queryClient.setQueryData(CONFESSION_KEYS.feed, (data) => {
    if (!data?.pages?.length) return data;
    const held = new Set();
    const pages = data.pages.map((page) => ({
      ...page,
      confessions: (page?.confessions ?? []).flatMap((c) => {
        if (gone.has(c.id)) return [];
        held.add(c.id);
        const fresh = states[c.id];
        return [fresh && !reactionQueues.has(c.id) ? { ...c, ...fresh } : c];
      }),
    }));
    const added = newer.filter((c) => c?.id && !held.has(c.id) && !gone.has(c.id));
    if (added.length > 0) {
      pages[0] = { ...pages[0], confessions: [...added, ...pages[0].confessions] };
    }
    return { ...data, pages };
  });
  for (const id of gone) queryClient.invalidateQueries({ queryKey: CONFESSION_KEYS.one(id) });
  for (const [id, fresh] of Object.entries(states)) {
    if (reactionQueues.has(id)) continue;
    queryClient.setQueryData(CONFESSION_KEYS.one(id), (d) => (d?.confession ? { ...d, confession: { ...d.confession, ...fresh } } : d));
  }
}

/**
 * Keeps the open Confessions page current, cheaply.
 *
 *   - Live: joins the campus's confessions room (the server picks the room
 *     from the caller's affiliation) and applies reaction totals as they
 *     change, everyone's. Left on unmount; re-joined after a reconnect.
 *   - Catching up: when the page opens on a feed it already had, comes back
 *     to the front after a while, or the socket reconnects (events may have
 *     been missed), ONE request asks what is newer than the top of the feed
 *     and for fresh totals of what it shows, and drops what is gone. Not
 *     more than once every SYNC_MIN_GAP_MS. More new than one answer holds:
 *     the feed restarts from its first page instead.
 */
export function useConfessionsLive({ enabled = true } = {}) {
  const queryClient = useQueryClient();
  const socket = useGlobalSocketStore((st) => st.socket);
  const isConnected = useGlobalSocketStore((st) => st.isConnected);
  const hasAccess = useHasCampusAccess();
  const active = enabled && hasAccess;
  const mountedAt = useRef(Date.now());

  const sync = useCallback(async ({ force = false } = {}) => {
    const now = Date.now();
    if (!force && now - lastSyncAt < SYNC_MIN_GAP_MS) return;
    const data = queryClient.getQueryData(CONFESSION_KEYS.feed);
    const loaded = (data?.pages ?? []).flatMap((p) => p?.confessions ?? []);
    if (loaded.length === 0) return; // nothing held: the feed's own fetch is current
    lastSyncAt = now;
    try {
      const result = await confessionsApi.sync({
        after: cursorOf(loaded[0]),
        ids: loaded.slice(0, SYNC_MAX_IDS).map((c) => c.id),
      });
      if (result?.hasMoreNewer) {
        // Too much has happened to patch in: start again from the top,
        // keeping what is on screen until the first page arrives.
        queryClient.setQueryData(CONFESSION_KEYS.feed, (d) => (d?.pages?.length
          ? { ...d, pages: d.pages.slice(0, 1), pageParams: d.pageParams.slice(0, 1) }
          : d));
        await queryClient.refetchQueries({ queryKey: CONFESSION_KEYS.feed, exact: true });
        return;
      }
      applySync(queryClient, result);
    } catch {
      // Best effort: the feed already on screen stays, and the next return
      // to the page asks again.
      lastSyncAt = 0;
    }
  }, [queryClient]);

  // Opening on a feed fetched earlier (not by this visit).
  useEffect(() => {
    if (!active) return;
    const state = queryClient.getQueryState(CONFESSION_KEYS.feed);
    if (state?.dataUpdatedAt && state.dataUpdatedAt < mountedAt.current) void sync({ force: true }); // not awaited: patches the cache when it lands
  }, [active, queryClient, sync]);

  // Back to the front after a while.
  useEffect(() => {
    if (!active) return undefined;
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
      } else if (hiddenAt && Date.now() - hiddenAt >= AWAY_MS) {
        void sync(); // not awaited: patches the cache when it lands
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [active, sync]);

  // The room, and its events. A reconnect is a new socket session: join
  // again, and catch up on what was missed while disconnected.
  const connectedOnce = useRef(false);
  useEffect(() => {
    if (!active || !socket || !isConnected) return undefined;
    socket.emit('confessions:join');
    if (connectedOnce.current) void sync(); // not awaited: patches the cache when it lands
    connectedOnce.current = true;
    const onEvent = (event) => {
      if (event?.type === 'confession.reactions') applyLiveReactions(queryClient, event.data);
    };
    socket.on('domainEvent', onEvent);
    return () => {
      socket.off('domainEvent', onEvent);
      socket.emit('confessions:leave');
    };
  }, [active, socket, isConnected, queryClient, sync]);
}

