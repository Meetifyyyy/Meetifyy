import { EmptyState } from '@shared/components/ui/StateViews';
import NotificationItem from './NotificationItem';

export default function NotificationList({
  groupedNotifications,
  timeAgo,
  onNotifClick,
  onAcceptJoinRequest,
  onRejectJoinRequest,
  getUserById,
  pageStyles
}) {
  const resolveActor = (notif) => {
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
    const fallbackId = notif.actorId || notif.entityId;
    if (fallbackId && getUserById) {
      const u = getUserById(fallbackId);
      if (u) {
        return {
          name: u.displayName || u.username,
          avatar: u.avatar || '',
          username: u.username || ''
        };
      }
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
    <>
      {groupedNotifications.map(group => (
        <div key={group.key} className={pageStyles.group}>
          <h2 className={pageStyles.groupTitle}>{group.title}</h2>
          <div className={pageStyles.groupItems}>
            {group.items.map(notif => (
              <NotificationItem
                key={notif.id}
                notif={notif}
                actor={resolveActor(notif)}
                timeStr={formatTimeStr(notif.createdAt)}
                onClick={onNotifClick}
                onAcceptJoinRequest={onAcceptJoinRequest}
                onRejectJoinRequest={onRejectJoinRequest}
              />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
