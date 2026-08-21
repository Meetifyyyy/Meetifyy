import { useMemo } from 'react';
import { useConversations } from '@shared/hooks/useMessages';

export function useUnreadCounts() {
  // The previous source returned a shallow copy of this same array; readers only iterate it.
  const { conversations = [] } = useConversations();

  return useMemo(() => {
    let dm = 0;
    let group = 0;

    conversations.forEach(conv => {
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

    return {
      dm,
      group,
      total: dm + group
    };
  }, [conversations]);
}
