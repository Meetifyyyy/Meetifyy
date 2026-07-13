import { useNavigate } from 'react-router-dom';
import { useNotifications } from '../../context/NotificationContext';
import { useData } from '../../context/DataContext';
import { isImageUrl } from '../../utils/avatar';
import DefaultAvatar from '../common/DefaultAvatar';
import styles from './NotificationsMenu.module.css';

const TYPE_ICONS = {
  follow: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" /><line x1="20" y1="8" x2="20" y2="14" /><line x1="23" y1="11" x2="17" y2="11" />
    </svg>
  ),
  like: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="var(--color-primary)" stroke="var(--color-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  ),
  comment: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
  community_join: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  crew_join: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" />
    </svg>
  ),
  ACTIVITY_JOIN_REQUEST: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" /><line x1="20" y1="8" x2="20" y2="14" /><line x1="23" y1="11" x2="17" y2="11" />
    </svg>
  ),
  activity_discussion: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="10" r="1" /><circle cx="16" cy="10" r="1" /><circle cx="8" cy="10" r="1" />
    </svg>
  ),
  mention: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" /><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" />
    </svg>
  ),
};

export default function NotificationsMenu({ isOpen, onClose }) {
  const { notifications, markAsRead, markAllRead, dismissNotification, clearAll, unreadCount, timeAgo } = useNotifications();
  const { getUserById, acceptJoinRequest, rejectJoinRequest } = useData();
  const navigate = useNavigate();

  const handleClick = (notif) => {
    markAsRead(notif.id);

    switch (notif.type) {
      case 'follow':
        if (notif.targetUsername) navigate(`/profile/${notif.targetUsername}`);
        break;
      case 'mention':
        if (notif.postId) navigate(`/post/${notif.postId}`);
        else if (notif.convId) navigate(`/messages/${notif.convId}`);
        else if (notif.activityId) navigate(`/crew/${notif.activityId}?discussion=1`);
        else if (notif.communityId) navigate(`/communities/${notif.communityId}`);
        else navigate('/home');
        break;
      case 'like':
      case 'comment':
        navigate('/home');
        break;
      case 'community_join':
        if (notif.communityId) navigate(`/communities/${notif.communityId}`);
        break;
      case 'crew_join':
      case 'activity_discussion':
        if (notif.activityId) navigate(`/crew/${notif.activityId}?discussion=1`);
        break;
      default:
        navigate('/home');
    }
    onClose();
  };

  const handleDismiss = (e, id) => {
    e.stopPropagation();
    dismissNotification(id);
  };

  const resolveActor = (actorId) => {
    if (!actorId) return { name: 'Someone', avatar: '?' };
    const user = getUserById(actorId);
    if (user) return { name: user.displayName || user.name || user.username, avatar: user.avatar };
    return { name: 'Someone', avatar: '?' };
  };

  return (
    <div className={`${styles.notificationsDropdown} ${isOpen ? styles.open : ''}`} onClick={(e) => e.stopPropagation()}>
      <div className={styles.header}>
        <h3 className={styles.title}>
          Notifications
          {unreadCount > 0 && <span className={styles.countBadge}>{unreadCount}</span>}
        </h3>
        <div className={styles.headerActions}>
          {unreadCount > 0 && (
            <button className={styles.headerBtn} onClick={(e) => { e.stopPropagation(); markAllRead(); }}>
              Mark all read
            </button>
          )}
          {notifications.length > 0 && (
            <button className={styles.headerBtn} onClick={(e) => { e.stopPropagation(); clearAll(); }}>
              Clear all
            </button>
          )}
        </div>
      </div>

      <div className={styles.list}>
        {notifications.length === 0 ? (
          <div className={styles.empty}>
            <div className={styles.emptyIcon}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            </div>
            <span>All caught up</span>
          </div>
        ) : (
          notifications.map(notif => {
            const actor = resolveActor(notif.actorId);
            return (
              <div
                key={notif.id}
                className={`${styles.item} ${notif.read ? '' : styles.unread}`}
                onClick={() => handleClick(notif)}
              >
                <div className={styles.avatar}>
                  {isImageUrl(actor.avatar) ? (
                    <img src={actor.avatar} className={styles.avatarImg} alt="" />
                  ) : (
                    <DefaultAvatar size={36} />
                  )}
                  <div className={styles.typeIcon}>
                    {TYPE_ICONS[notif.type] || null}
                  </div>
                </div>

                <div className={styles.content}>
                  <div className={styles.text}>
                    <strong>{actor.name}</strong> {notif.text}
                  </div>
                  <div className={styles.time}>{timeAgo(notif.createdAt)}</div>
                  {notif.type === 'ACTIVITY_JOIN_REQUEST' && (
                    <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                      <button 
                        style={{ padding: '4px 12px', background: 'var(--color-primary)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          acceptJoinRequest(notif.activityId, notif.actorId);
                          dismissNotification(notif.id);
                        }}
                      >
                        Accept
                      </button>
                      <button 
                        style={{ padding: '4px 12px', background: 'transparent', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          rejectJoinRequest(notif.activityId, notif.actorId);
                          dismissNotification(notif.id);
                        }}
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>

                <button
                  className={styles.dismissBtn}
                  onClick={(e) => handleDismiss(e, notif.id)}
                  aria-label="Dismiss"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
