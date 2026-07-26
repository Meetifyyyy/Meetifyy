import { useMemo } from 'react';
import { useData } from '@shared/hooks/useData';

export function useUnreadCounts() {
  const { conversations = [] } = useData();

  return useMemo(() => {
    let dm = 0;
    let group = 0;
    let activity = 0;

    conversations.forEach(conv => {
      const isUnread = (conv.unread || 0) > 0;
      if (!isUnread) return;

      const isCampusGroup = String(conv.id).startsWith('c_') || conv.isCampusGroup;
      const isActivityChat = !!(conv.isActivityChat || String(conv.id).startsWith('act_') || conv.activityId);
      const isGroupChat = conv.isGroup || isCampusGroup;

      if (isActivityChat) {
        activity += conv.unread;
      } else if (isGroupChat) {
        group += conv.unread;
      } else {
        dm += conv.unread;
      }
    });

    return {
      dm,
      group,
      activity,
      total: dm + group + activity
    };
  }, [conversations]);
}
