import { useMemo } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { EmptyState } from '@shared/components/ui/StateViews';
import NotificationItem from './NotificationItem';
import { useData } from '@shared/hooks/useData';

export default function NotificationList({
  groupedNotifications,
  timeAgo,
  onNotifClick,
  onAcceptJoinRequest,
  onRejectJoinRequest,
  pageStyles
}) {
  const { users, getUserById } = useData();

  const resolveActor = (notif) => {
    const actorId = notif.actor?.id || notif.actorId || notif.metadata?.actorId;
    const actorUsername = notif.actor?.username || notif.metadata?.actorUsername || notif.metadata?.username || notif.metadata?.actorName;

    let liveUser = null;
    if (actorId && getUserById) {
      liveUser = getUserById(actorId);
    }
    if (!liveUser && users) {
      if (actorId && users[actorId]) {
        liveUser = users[actorId];
      } else if (actorUsername) {
        liveUser = Object.values(users).find(u => 
          u.username === actorUsername || 
          u.displayName === actorUsername || 
          u.name === actorUsername
        );
      }
    }

    if (liveUser) {
      return {
        name: liveUser.displayName || liveUser.username || 'Someone',
        avatar: liveUser.avatar || '',
        username: liveUser.username || ''
      };
    }

    if (notif.actor && (notif.actor.displayName || notif.actor.username)) {
      return {
        name: notif.actor.displayName || notif.actor.username,
        avatar: notif.actor.avatar || '',
        username: notif.actor.username || ''
      };
    }

    if (notif.metadata?.actorName || notif.metadata?.actorDisplayName || notif.metadata?.username || notif.metadata?.actorUsername) {
      return { 
        name: notif.metadata.actorName || notif.metadata.actorDisplayName || notif.metadata.username || notif.metadata.actorUsername, 
        avatar: notif.metadata.actorAvatar || '',
        username: notif.metadata.actorUsername || notif.metadata.username || '' 
      };
    }

    return { name: 'Someone', avatar: '', username: '' };
  };

  const formatTimeStr = (createdAt) => {
    return timeAgo(createdAt)
      .replace(' ago', '')
      .replace('Yesterday', '1d')
      .replace('just now', 'now')
      .replace(' seconds', 's')
      .replace(' second', 's')
      .replace(' minutes', 'm')
      .replace(' minute', 'm')
      .replace(' hours', 'h')
      .replace(' hour', 'h')
      .replace(' days', 'd')
      .replace(' day', 'd')
      .replace(' weeks', 'w')
      .replace(' week', 'w');
  };

  const flatItems = useMemo(() => {
    const list = [];
    groupedNotifications.forEach(group => {
      list.push({ type: 'header', key: `header-${group.key}`, title: group.title });
      group.items.forEach(notif => {
        list.push({ type: 'item', key: notif.id, notif });
      });
    });
    return list;
  }, [groupedNotifications]);

  const virtualizer = useWindowVirtualizer({
    count: flatItems.length,
    estimateSize: (index) => (flatItems[index]?.type === 'header' ? 34 : 68),
    overscan: 6,
  });

  if (groupedNotifications.length === 0) {
    return (
      <EmptyState
        title="All caught up!"
        message="You have no new notifications right now."
        icon={
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: '1rem', opacity: 0.5 }}>
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        }
      />
    );
  }

  return (
    <div
      className={pageStyles.groupItems}
      style={{
        height: `${virtualizer.getTotalSize()}px`,
        position: 'relative',
        width: '100%',
      }}
    >
      {virtualizer.getVirtualItems().map((virtualItem) => {
        const item = flatItems[virtualItem.index];

        return (
          <div
            key={virtualItem.key}
            data-index={virtualItem.index}
            ref={virtualizer.measureElement}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualItem.start}px)`,
            }}
          >
            {item.type === 'header' ? (
              <h2 className={pageStyles.groupTitle} style={{ margin: '0.5rem 0 0.25rem 0.5rem' }}>
                {item.title}
              </h2>
            ) : (
              <NotificationItem
                notif={item.notif}
                actor={resolveActor(item.notif)}
                timeStr={formatTimeStr(item.notif.createdAt)}
                onClick={onNotifClick}
                onAcceptJoinRequest={onAcceptJoinRequest}
                onRejectJoinRequest={onRejectJoinRequest}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
