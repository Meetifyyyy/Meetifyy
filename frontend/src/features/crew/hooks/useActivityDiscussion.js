import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { activitiesApi } from '@shared/api/apiClient';
import { useAuth } from '@shared/context/AuthContext';
import { useGlobalSocketStore } from '@shared/stores/useGlobalSocketStore';

const PAGE_SIZE = 20;

/**
 * Data layer for an activity's discussion.
 *
 * - History is loaded/paginated (older messages) via an infinite query.
 * - New messages (both realtime arrivals from the `activity_<id>` socket room
 *   and the current user's own optimistic sends) live in a small `liveMessages`
 *   buffer, then merged + de-duped by id with the paginated history.
 * - Joins the socket room on mount and leaves on unmount (rooms also auto-clean
 *   server-side on disconnect, so a dropped 'activity:leave' can't leak).
 */
export function useActivityDiscussion(activityId, { enabled = true } = {}) {
  const { currentUser } = useAuth();
  const socket = useGlobalSocketStore((s) => s.socket);
  const queryClient = useQueryClient();

  const [liveMessages, setLiveMessages] = useState([]);
  const [sendError, setSendError] = useState(null);
  const [isSending, setIsSending] = useState(false);

  const {
    data,
    isLoading,
    isError,
    error,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    refetch,
  } = useInfiniteQuery({
    queryKey: ['activity-discussion', activityId],
    queryFn: ({ pageParam }) =>
      activitiesApi.getDiscussion(activityId, { before: pageParam, limit: PAGE_SIZE }),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => (lastPage?.hasMore ? lastPage.nextCursor : undefined),
    enabled: Boolean(activityId) && enabled,
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });

  // History flattened oldest → newest. page[0] is the most recent chunk, later
  // pages are progressively older, so reverse the page order before flattening.
  const historyMessages = useMemo(() => {
    const pages = data?.pages || [];
    return [...pages].reverse().flatMap((p) => p?.messages || []);
  }, [data]);

  // Merge history + live, de-dupe by id (server id wins over optimistic tempId),
  // and keep chronological order.
  const messages = useMemo(() => {
    const byId = new Map();
    for (const m of historyMessages) byId.set(m.id, m);
    for (const m of liveMessages) {
      // Drop an optimistic entry once its real (server) counterpart exists.
      if (m.tempId && byId.has(m.id)) continue;
      byId.set(m.id, m);
    }
    return Array.from(byId.values()).sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
  }, [historyMessages, liveMessages]);

  // ─── Realtime: join room + listen for new messages ──────────────────────────
  useEffect(() => {
    if (!socket || !activityId || !enabled) return;

    socket.emit('activity:join', { activityId });

    const handleNew = (msg) => {
      if (!msg || String(msg.activityId) !== String(activityId)) return;
      // Our own sends are handled by the mutation flow; ignore the echo.
      if (String(msg.userId) === String(currentUser?.id)) return;
      setLiveMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
    };

    // The server authorizes room joins and can evict a subscriber whose access
    // was revoked mid-session (e.g. the host switched the activity to Private).
    // Both cases clear the buffer and re-validate the activity, which flips the
    // page to the access-denied state instead of leaving stale content on screen.
    const handleAccessLost = (payload) => {
      if (payload?.activityId && String(payload.activityId) !== String(activityId)) return;
      setLiveMessages([]);
      queryClient.invalidateQueries({ queryKey: ['activity', activityId] });
      queryClient.invalidateQueries({ queryKey: ['activity-discussion', activityId] });
    };

    socket.on('activity_discussion:new', handleNew);
    socket.on('activity:access_denied', handleAccessLost);
    socket.on('activity:access_revoked', handleAccessLost);

    return () => {
      socket.off('activity_discussion:new', handleNew);
      socket.off('activity:access_denied', handleAccessLost);
      socket.off('activity:access_revoked', handleAccessLost);
      socket.emit('activity:leave', { activityId });
    };
  }, [socket, activityId, enabled, currentUser?.id, queryClient]);

  const sendMessage = useCallback(
    async (text) => {
      const trimmed = (text || '').trim();
      if (!trimmed || !activityId) return;

      const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const optimistic = {
        id: tempId,
        tempId,
        activityId,
        text: trimmed,
        createdAt: new Date().toISOString(),
        userId: currentUser?.id,
        pending: true,
        user: {
          id: currentUser?.id,
          username: currentUser?.username,
          displayName: currentUser?.displayName || currentUser?.username,
          avatar: currentUser?.avatar || null,
        },
      };

      setSendError(null);
      setIsSending(true);
      setLiveMessages((prev) => [...prev, optimistic]);

      try {
        const real = await activitiesApi.sendDiscussionMessage(activityId, trimmed);
        // Replace the optimistic entry with the server message.
        setLiveMessages((prev) => prev.map((m) => (m.tempId === tempId ? { ...real } : m)));
      } catch (err) {
        // Roll back the optimistic entry and surface the error.
        setLiveMessages((prev) => prev.filter((m) => m.tempId !== tempId));
        setSendError('Failed to send. Tap to retry.');
        throw err;
      } finally {
        setIsSending(false);
      }
    },
    [activityId, currentUser]
  );

  return {
    messages,
    isLoading,
    isError,
    error,
    hasMore: Boolean(hasNextPage),
    isFetchingMore: isFetchingNextPage,
    loadMore: fetchNextPage,
    refetch,
    sendMessage,
    isSending,
    sendError,
    clearSendError: () => setSendError(null),
  };
}
