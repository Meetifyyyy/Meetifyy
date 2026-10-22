import { useCallback, useMemo } from 'react';
import { useAppIdle } from './useAppIdle';
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { notificationsApi } from '../api/apiClient';

import { useAuth } from '../context/AuthContext';

const UNREAD_COUNT_KEY = ['notifications', 'unreadCount'];

/**
 * The notification feed query, shared by the page and the idle prefetch in
 * DashboardLayoutWrapper, so a warmed cache entry is exactly the one the page
 * reads (same key, same request, same page size).
 */
export function notificationsQueryOptions(type) {
  return {
    queryKey: type ? ['notifications', { type }] : ['notifications'],
    queryFn: ({ pageParam = undefined }) => notificationsApi.getAll(15, pageParam, type),
    getNextPageParam: (lastPage) => lastPage?.nextCursor || undefined,
    // Stated rather than left to the `pageParam = undefined` default in the
    // queryFn signature. Same first request either way; v5 expects it declared.
    initialPageParam: undefined,
    staleTime: 1000 * 60, // 1 minute
  };
}

/**
 * Every cached notification LIST, and not the unread count.
 *
 * `['notifications']` prefix-matches the count entry too, so the blanket
 * invalidations this hook used to run took it out along with the feeds. The
 * count is a number the mutations below already know the new value of.
 */
const isNotificationListQuery = (query) =>
  query.queryKey[0] === 'notifications' && query.queryKey[1] !== 'unreadCount';

/** Apply `fn` to every notification row across all cached list pages. */
function mapRows(old, fn) {
  if (!old?.pages) return old;
  let changed = false;
  const pages = old.pages.map((page) => {
    if (!Array.isArray(page?.data)) return page;
    let pageChanged = false;
    const data = page.data.reduce((acc, row) => {
      const next = fn(row);
      if (next !== row) pageChanged = true;
      if (next) acc.push(next);
      return acc;
    }, []);
    if (!pageChanged) return page;
    changed = true;
    return { ...page, data };
  });
  return changed ? { ...old, pages } : old;
}

/**
 * `readAt` is the only thing the server sends — there is no `read` column, and
 * no endpoint returns one. `read` is still checked because
 * NotificationItem accepts either, and a row could carry one from elsewhere.
 */
const isUnread = (n) => !n.read && !n.readAt;

/**
 * Marks a row read the way the SERVER would.
 *
 * Only `readAt`, deliberately. Setting an extra `read: true` works — the item
 * component accepts either — but it invents a field no response carries, so an
 * optimistic row and the same row after a refetch would no longer be the same
 * shape. Mirroring the server means nothing downstream can tell which it got.
 */
const markRead = (n) => (isUnread(n) ? { ...n, readAt: new Date().toISOString() } : n);

/**
 * The notification feed, its unread count, and the three things you can do to a
 * notification.
 */
export function useNotifications({ type } = {}) {
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();

  // A filtered feed is its own cache entry so the Invitations tab can page
  // through invite history without disturbing (or being truncated by) the main
  // list. Both are server-backed, so neither can drift from the database.
  const options = useMemo(() => notificationsQueryOptions(type), [type]);

  const {
    data, isLoading, isFetching, isFetchedAfterMount, isStale, isError, error,
    fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useInfiniteQuery({
    ...options,
    enabled: Boolean(currentUser?.id),
  });

  const appIdle = useAppIdle();
  const { data: unreadCountData } = useQuery({
    queryKey: UNREAD_COUNT_KEY,
    queryFn: () => notificationsApi.getUnreadCount(),
    // No HTTP polling: the count is pushed over the socket, and the mutations
    // below write the new value straight into this entry. Fetched once the
    // first screen is up (useAppIdle): the badge can wait a moment.
    staleTime: Infinity,
    enabled: Boolean(currentUser?.id) && appIdle,
  });

  /** Nudge the cached unread count without a round trip. */
  const bumpUnread = useCallback(
    (delta) => {
      queryClient.setQueryData(UNREAD_COUNT_KEY, (old) => {
        const current = old?.count || 0;
        return { ...(old || {}), count: Math.max(0, current + delta) };
      });
    },
    [queryClient],
  );

  /**
   * Put the feeds back the way the server has them.
   *
   * The optimistic writes below are the fast path; this is what runs when one
   * of them turns out to have been wrong. Only on failure, so the normal case
   * still costs no network.
   */
  const resync = useCallback(() => {
    queryClient.invalidateQueries({ predicate: isNotificationListQuery });
    queryClient.invalidateQueries({ queryKey: UNREAD_COUNT_KEY });
  }, [queryClient]);

  /**
   * Whether any notifications query (a list or the count) is mid-fetch.
   *
   * The mutations below cancel those fetches so a stale answer cannot overwrite
   * the optimistic write. A cancelled fetch is not retried by itself, and on the
   * installed app it may have been the revalidation of a restored snapshot, so
   * whatever was interrupted is fetched again once the mutation settles.
   */
  const isFetchingAny = useCallback(
    () => queryClient.isFetching({ queryKey: ['notifications'] }) > 0,
    [queryClient],
  );
  const redoInterrupted = useCallback(
    (_data, _err, _vars, ctx) => {
      if (ctx?.interrupted) resync();
    },
    [resync],
  );

  /*
   * These used to invalidate `['notifications']` on success, which refetched
   * every loaded page of every feed AND the unread count. Opening this page
   * marks everything read automatically, so simply arriving re-downloaded the
   * whole list that had just been rendered.
   *
   * The new state is known locally in all three cases, so it is written into
   * the cache directly and nothing is refetched unless the request fails.
   */
  const markAsReadMutation = useMutation({
    mutationFn: (id) => notificationsApi.markAsRead(id),
    onMutate: async (id) => {
      // The whole prefix, the unread count included: a count fetch already in
      // flight answers with a number from before this write, and landing later
      // it would bring a cleared badge back.
      const interrupted = isFetchingAny();
      await queryClient.cancelQueries({ queryKey: ['notifications'] });
      const snapshot = queryClient.getQueriesData({ predicate: isNotificationListQuery });
      const previousCount = queryClient.getQueryData(UNREAD_COUNT_KEY);

      let wasUnread = false;
      queryClient.setQueriesData({ predicate: isNotificationListQuery }, (old) =>
        mapRows(old, (n) => {
          if (n.id !== id) return n;
          if (isUnread(n)) wasUnread = true;
          return markRead(n);
        }),
      );
      if (wasUnread) bumpUnread(-1);
      return { snapshot, previousCount, interrupted };
    },
    onError: (_err, _id, ctx) => {
      ctx?.snapshot?.forEach(([key, value]) => {
        if (value !== undefined) queryClient.setQueryData(key, value);
      });
      if (ctx?.previousCount !== undefined) {
        queryClient.setQueryData(UNREAD_COUNT_KEY, ctx.previousCount);
      }
      resync();
    },
    onSettled: redoInterrupted,
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => notificationsApi.markAllAsRead(),
    onMutate: async () => {
      const interrupted = isFetchingAny();
      await queryClient.cancelQueries({ queryKey: ['notifications'] });
      const snapshot = queryClient.getQueriesData({ predicate: isNotificationListQuery });
      const previousCount = queryClient.getQueryData(UNREAD_COUNT_KEY);

      queryClient.setQueriesData({ predicate: isNotificationListQuery }, (old) =>
        mapRows(old, markRead),
      );
      queryClient.setQueryData(UNREAD_COUNT_KEY, (old) => ({ ...(old || {}), count: 0 }));
      return { snapshot, previousCount, interrupted };
    },
    onError: (_err, _vars, ctx) => {
      ctx?.snapshot?.forEach(([key, value]) => {
        if (value !== undefined) queryClient.setQueryData(key, value);
      });
      if (ctx?.previousCount !== undefined) {
        queryClient.setQueryData(UNREAD_COUNT_KEY, ctx.previousCount);
      }
      resync();
    },
    onSettled: redoInterrupted,
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => notificationsApi.delete(id),
    onMutate: async (id) => {
      const interrupted = isFetchingAny();
      await queryClient.cancelQueries({ queryKey: ['notifications'] });
      const snapshot = queryClient.getQueriesData({ predicate: isNotificationListQuery });
      const previousCount = queryClient.getQueryData(UNREAD_COUNT_KEY);

      let removedUnread = false;
      queryClient.setQueriesData({ predicate: isNotificationListQuery }, (old) =>
        // Returning null drops the row — see mapRows.
        mapRows(old, (n) => {
          if (n.id !== id) return n;
          if (isUnread(n)) removedUnread = true;
          return null;
        }),
      );
      if (removedUnread) bumpUnread(-1);
      return { snapshot, previousCount, interrupted };
    },
    onError: (_err, _id, ctx) => {
      ctx?.snapshot?.forEach(([key, value]) => {
        if (value !== undefined) queryClient.setQueryData(key, value);
      });
      if (ctx?.previousCount !== undefined) {
        queryClient.setQueryData(UNREAD_COUNT_KEY, ctx.previousCount);
      }
      resync();
    },
    onSettled: redoInterrupted,
  });

  /**
   * Flattened once per change of `data`, not once per render.
   *
   * This was `data?.pages.flatMap(...) ?? []` evaluated inline, so it was a new
   * array every render — and it is the dependency of the grouping memo on the
   * notifications page and of every consumer's own memos. None of them could
   * ever hit.
   */
  const notifications = useMemo(
    () => data?.pages.flatMap((page) => page.data || []) ?? [],
    [data],
  );

  // Destructured so the dependency is a plain binding the linter can see.
  // `mutate` is stable for the life of the mutation in React Query v5, which is
  // what makes these callbacks stable — and callers put them in effect
  // dependency arrays, where the previous inline arrows re-ran on every render.
  const { mutate: mutateMarkAsRead } = markAsReadMutation;
  const { mutate: mutateMarkAllRead } = markAllReadMutation;
  const { mutate: mutateDelete } = deleteMutation;

  const markAsRead = useCallback((id) => mutateMarkAsRead(id), [mutateMarkAsRead]);
  // Wrapped rather than passed through: handed straight to an onClick it would
  // receive the event as its mutation variables.
  const markAllRead = useCallback(() => mutateMarkAllRead(), [mutateMarkAllRead]);
  const dismissNotification = useCallback((id) => mutateDelete(id), [mutateDelete]);

  // Memoised for the same reason as `notifications`: this object was rebuilt on
  // every render, so every consumer of the hook re-rendered on every render of
  // its own parent, whether or not anything here had changed.
  return useMemo(
    () => ({
      notifications,
      unreadCount: unreadCountData?.count || 0,
      isLoading,
      // True when the list is a real network answer that is current: fetched
      // by this mount, or fetched recently enough to still be fresh, and no
      // refetch in flight. A restored snapshot (installed app) is always stale
      // and invalidated, so it never counts until the network replaces it.
      isFresh: (isFetchedAfterMount || !isStale) && !isFetching && !isError,
      error,
      fetchNextPage,
      hasNextPage,
      isFetchingNextPage,
      markAsRead,
      markAllRead,
      dismissNotification,
    }),
    [
      notifications, unreadCountData?.count, isLoading, isFetchedAfterMount, isStale, isFetching, isError, error,
      fetchNextPage, hasNextPage, isFetchingNextPage,
      markAsRead, markAllRead, dismissNotification,
    ],
  );
}

/**
 * Just the unread badge number.
 *
 * The bell sits in the header on every route and read `unreadCount` off the
 * full hook, which mounts the infinite feed query — so every page in the app
 * fetched page one of the notification list to render a number that comes from
 * a different endpoint. This subscribes to the count entry alone.
 */
export function useUnreadNotificationCount() {
  const { currentUser } = useAuth();
  const appIdle = useAppIdle();

  const { data } = useQuery({
    queryKey: UNREAD_COUNT_KEY,
    queryFn: () => notificationsApi.getUnreadCount(),
    staleTime: Infinity,
    // After the first screen (useAppIdle); the socket keeps it current after.
    enabled: Boolean(currentUser?.id) && appIdle,
  });

  return data?.count || 0;
}
