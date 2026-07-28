import { useMemo } from 'react';
import { useData } from '@shared/hooks/useData';

export function useUnreadCounts() {
  const { conversations = [] } = useData();

  return useMemo(() => {
    let dm = 0;
    let group = 0;

    conversations.forEach(conv => {
      const count = Math.max(0, conv.unreadCount || conv.unread || 0);
      if (count === 0) return;

      const isGroupChat =
        conv.isGroup ||
        conv.isActivityChat ||
        conv.isCampusGroup ||
        conv.activityId ||
        String(conv.id).startsWith('c_') ||
        String(conv.id).startsWith('act_');

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
