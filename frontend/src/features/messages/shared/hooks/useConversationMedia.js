import { useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { messagesApi } from '@shared/api/apiClient';
import { useAuth } from '@shared/context/AuthContext';
import { CONVERSATION_MEDIA_KEY } from '../utils/conversationMediaCache';

/**
 * A gallery entry as the UI uses it.
 *
 * `report` names the MESSAGE (never the URL), and only for somebody else's: a
 * person does not report their own attachment.
 */
export function toGalleryItem(raw, myId) {
  return {
    id: raw.messageId,
    type: raw.kind,
    url: raw.mediaUrl,
    thumbnailUrl: raw.thumbnailUrl || '',
    width: raw.width,
    height: raw.height,
    duration: raw.duration,
    senderId: raw.senderId,
    createdAt: Date.parse(raw.createdAt),
    report: raw.senderId !== myId ? { targetType: 'MESSAGE', targetId: raw.messageId } : undefined,
  };
}

/**
 * The conversation's shared photos and videos, newest first, from the server.
 *
 * The gallery used to be computed from whichever history pages the chat screen
 * happened to hold, so older media was missing, "No media" described the cache
 * rather than the chat, and anything that replaced that cache (search, reopening
 * the header) could blank it. This reads its own query, keyed only by the
 * conversation and the page size, which nothing else writes.
 *
 * @param {string} conversationId
 * @param {{ pageSize: number, enabled?: boolean }} options
 *   `pageSize` is chosen by the caller from the space it has (see galleryLayout);
 *   `0` means "not measured yet" and keeps the query idle.
 */
export function useConversationMedia(conversationId, { pageSize, enabled = true } = {}) {
  const { currentUser } = useAuth();
  const myId = currentUser?.id;

  const query = useInfiniteQuery({
    queryKey: [CONVERSATION_MEDIA_KEY, String(conversationId ?? ''), pageSize],
    queryFn: ({ pageParam, signal }) =>
      messagesApi.getConversationMedia(conversationId, { before: pageParam, limit: pageSize, signal }),
    initialPageParam: undefined,
    getNextPageParam: (last) => last?.nextCursor || undefined,
    enabled: enabled && Boolean(conversationId) && pageSize > 0,
    staleTime: 30_000,
  });

  const items = useMemo(() => {
    const seen = new Set();
    const list = [];
    for (const page of query.data?.pages ?? []) {
      for (const raw of page?.items ?? []) {
        if (!raw || seen.has(raw.messageId)) continue;
        seen.add(raw.messageId);
        list.push(toGalleryItem(raw, myId));
      }
    }
    return list;
  }, [query.data, myId]);

  return {
    items,
    // `isPending` is true for an idle query too, which is the right answer for
    // "nothing to show yet": the caller has not measured, or has no conversation.
    isPending: query.isPending,
    isError: query.isError,
    hasNextPage: Boolean(query.hasNextPage),
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: query.fetchNextPage,
    refetch: query.refetch,
  };
}
