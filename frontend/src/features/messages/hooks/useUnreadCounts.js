import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useConversations, CONVERSATION_LIST_PAGE } from '@shared/hooks/useMessages';
import { useAuth } from '@shared/context/AuthContext';
import { messagesApi } from '@shared/api/apiClient';
import { UNREAD_SUMMARY_KEY, withUnloadedUnread } from '../shared/utils/unreadSummary';

/**
 * The unread totals behind the navigation badges, from the conversation list.
 *
 * The badge counts what the person can act on. A muted chat keeps its own
 * count on its row but does not raise the badge (that is what muting asks
 * for), and a group they are no longer in counts nothing.
 */
export function sumUnread(conversations) {
  let dm = 0;
  let group = 0;

  (conversations || []).forEach((conv) => {
    if (!conv || conv.muted || conv.isMuted) return;
    if (conv.isMember === false || conv.myMembershipStatus === 'KICKED' || conv.myMembershipStatus === 'LEFT') return;
    const count = Math.max(0, conv.unreadCount || conv.unread || 0);
    if (count === 0) return;

    const isGroupChat =
      conv.isGroup ||
      conv.isCampusGroup ||
      String(conv.id).startsWith('c_');

    if (isGroupChat) {
      group += count;
    } else {
      dm += count;
    }
  });

  return { dm, group, total: dm + group };
}

export function useUnreadCounts() {
  // The previous source returned a shallow copy of this same array; readers only iterate it.
  const { conversations = [] } = useConversations();
  const { isLoggedIn } = useAuth();
  // A list shorter than a page already holds every conversation.
  const partial = conversations.length >= CONVERSATION_LIST_PAGE;
  const { data: summary } = useQuery({
    queryKey: UNREAD_SUMMARY_KEY,
    queryFn: () => messagesApi.getUnreadSummary(),
    enabled: isLoggedIn && partial,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  return useMemo(
    () => withUnloadedUnread(sumUnread(conversations), conversations, partial ? summary : null),
    [conversations, partial, summary],
  );
}
