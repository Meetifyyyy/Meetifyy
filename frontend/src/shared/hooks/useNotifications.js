import { useCallback, useMemo } from 'react';
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { notificationsApi } from '../api/apiClient';

import { useAuth } from '../context/AuthContext';

const UNREAD_COUNT_KEY = ['notifications', 'unreadCount'];

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

const isUnread = (n) => !n.read && !n.readAt;
const markRead = (n) => (isUnread(n) ? { ...n, read: true, readAt: new Date().toISOString() } : n);

/**
 * The notification feed, its unread count, and the three things you can do to a
 * notification.
 *
 * `enabled` defers the request for a feed that is not on screen yet.
 */
export function useNotifications({ type, enabled = true } = {}) {
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();

  // A filtered feed is its own cache entry so the Invitations tab can page
  // through invite history without disturbing (or being truncated by) the main
  // list. Both are server-backed, so neither can drift from the database.
  const queryKey = useMemo(() => (type ? ['notifications', { type }] : ['notifications']), [type]);

  const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam = undefined }) => notificationsApi.getAll(15, pageParam, type),
    getNextPageParam: (lastPage) => lastPage?.nextCursor || undefined,
    initialPageParam: undefined,
    enabled: enabled && Boolean(currentUser?.id),
    staleTime: 1000 * 60, // 1 minute
  });

  const { data: unreadCountData } = useQuery({
    queryKey: UNREAD_COUNT_KEY,
    queryFn: () => notificationsApi.getUnreadCount(),
    // No HTTP polling: the count is pushed over the socket, and the mutations
    // below write the new value straight into this entry.
    staleTime: Infinity,
    enabled: Boolean(currentUser?.id),
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
      await queryClient.cancelQueries({ predicate: isNotificationListQuery });
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
      return { snapshot, previousCount };
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
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => notificationsApi.markAllAsRead(),
    onMutate: async () => {
      await queryClient.cancelQueries({ predicate: isNotificationListQuery });
      const snapshot = queryClient.getQueriesData({ predicate: isNotificationListQuery });
      const previousCount = queryClient.getQueryData(UNREAD_COUNT_KEY);

      queryClient.setQueriesData({ predicate: isNotificationListQuery }, (old) =>
        mapRows(old, markRead),
      );
      queryClient.setQueryData(UNREAD_COUNT_KEY, (old) => ({ ...(old || {}), count: 0 }));
      return { snapshot, previousCount };
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
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => notificationsApi.delete(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ predicate: isNotificationListQuery });
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
      return { snapshot, previousCount };
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
      error,
      fetchNextPage,
      hasNextPage,
      isFetchingNextPage,
      markAsRead,
      markAllRead,
      dismissNotification,
    }),
    [
      notifications, unreadCountData?.count, isLoading, error,
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

  const { data } = useQuery({
    queryKey: UNREAD_COUNT_KEY,
    queryFn: () => notificationsApi.getUnreadCount(),
    staleTime: Infinity,
    enabled: Boolean(currentUser?.id),
  });

  return data?.count || 0;
}
