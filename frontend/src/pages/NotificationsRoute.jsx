import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotifications } from '../context/NotificationContext';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { useSimulatedFetch } from '../hooks/useSimulatedFetch';
import { isImageUrl } from '../utils/avatar';
import { useSmartBack } from '../hooks/useSmartBack';
import DefaultAvatar from '../components/common/DefaultAvatar';
import FollowButton from '../components/common/FollowButton';
import Skeleton from '../components/common/Skeleton';
import { ErrorState, EmptyState } from '../components/common/StateViews';
import PageHeader from '../components/layout/PageHeader';
import styles from './NotificationsRoute.module.css';

function NotificationSkeleton() {
  return (
    <div className={styles.item} style={{ pointerEvents: 'none', background: 'var(--color-bg-white)' }}>
      <div className={styles.avatar} style={{ background: 'transparent' }}>
        <Skeleton type="circle" width="40px" height="40px" />
      </div>
      <div className={styles.content} style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <Skeleton type="text" width="60%" height="1.1rem" style={{ marginBottom: '0.4rem' }} />
        <Skeleton type="text" width="40%" height="0.8rem" />
      </div>
      <div className={styles.actionSlot}>
        <Skeleton type="rect" width="70px" height="32px" style={{ borderRadius: '100px' }} />
      </div>
    </div>
  );
}

export default function NotificationsRoute() {
  const [activeTab, setActiveTab] = useState('all');
  const { currentUser } = useAuth();
  const { notifications, markAsRead, markAllRead, clearAll, timeAgo, dismissNotification } = useNotifications();
  const { getUserById, crewActivities, joinCrewActivity, declineCrewInvitation, acceptJoinRequest, rejectJoinRequest } = useData();
  const navigate = useNavigate();
  const goBack = useSmartBack();

  const invitations = crewActivities ? crewActivities.filter(a => 
    a.invitedUsers?.includes(currentUser?.id)
  ) : [];

  const [readInvitations, setReadInvitations] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('read_invitations') || '[]');
    } catch {
      return [];
    }
  });

  const markAllInvitationsRead = () => {
    const allIds = invitations.map(inv => inv.id);
    const updated = [...new Set([...readInvitations, ...allIds])];
    setReadInvitations(updated);
    localStorage.setItem('read_invitations', JSON.stringify(updated));
  };

  const clearAllInvitations = () => {
    invitations.forEach(inv => declineCrewInvitation(inv.id));
  };

  const handleInvClick = (inv) => {
    if (!readInvitations.includes(inv.id)) {
      const updated = [...readInvitations, inv.id];
      setReadInvitations(updated);
      localStorage.setItem('read_invitations', JSON.stringify(updated));
    }
    navigate(`/crew/${inv.id}`, { state: { activity: inv } });
  };

  const { isLoading, data: loadedNotifications, error, retry } = useSimulatedFetch(notifications, 800);

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
      case 'ACTIVITY_JOIN_REQUEST':
        // Don't navigate — the Accept/Reject buttons are inline on the notification
        break;
      default:
        navigate('/home');
    }
  };

  const resolveActor = (actorId) => {
    if (!actorId) return { name: 'Someone', avatar: '?' };
    const user = getUserById(actorId);
    if (user) return { name: user.displayName || user.name || user.username, username: user.username, avatar: user.avatar };
    return { name: 'Someone', avatar: '?' };
  };

  const groupedNotifications = useMemo(() => {
    if (!loadedNotifications) return [];
    const groups = {
      today: [],
      yesterday: [],
      thisWeek: [],
      earlier: []
    };

    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;

    loadedNotifications.forEach(notif => {
      const diff = now - notif.createdAt;
      if (diff < oneDay) {
        groups.today.push(notif);
      } else if (diff < 2 * oneDay) {
        groups.yesterday.push(notif);
      } else if (diff < 7 * oneDay) {
        groups.thisWeek.push(notif);
      } else {
        groups.earlier.push(notif);
      }
    });

    return [
      { title: 'Today', key: 'today', items: groups.today },
      { title: 'Yesterday', key: 'yesterday', items: groups.yesterday },
      { title: 'This Week', key: 'thisWeek', items: groups.thisWeek },
      { title: 'Earlier', key: 'earlier', items: groups.earlier }
    ].filter(g => g.items.length > 0);
  }, [loadedNotifications]);

  const headerTabs = useMemo(() => [
    { id: 'all', label: 'All Notifications' },
    { 
      id: 'invitations', 
      label: (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
          Invitations
          {invitations.length > 0 && (
            <span className={styles.tabBadge}>
              {invitations.length}
            </span>
          )}
        </span>
      )
    }
  ], [invitations.length]);

  return (
    <main className="centre centre-wide animate-in">
      <div className={styles.page}>
        <PageHeader
          title="Notifications"
          subtitle="Stay updated with your connections and activities."
          backPath="/home"
          tabs={headerTabs}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />

        <div className={styles.list}>
          {isLoading ? (
            <div className={styles.groupItems}>
              <NotificationSkeleton />
              <NotificationSkeleton />
              <NotificationSkeleton />
              <NotificationSkeleton />
              <NotificationSkeleton />
              <NotificationSkeleton />
            </div>
          ) : error ? (
            <ErrorState onRetry={retry} />
          ) : activeTab === 'invitations' ? (
            invitations.length === 0 ? (
              <EmptyState
                title="No new invitations right now"
                message="You don't have any pending crew invitations."
                icon={
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: '1rem', opacity: 0.5 }}>
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                  </svg>
                }
              />
            ) : (
              <div className={styles.groupItems}>
                {invitations.map(inv => (
                  <div key={inv.id} className={`${styles.invitationItem} ${!readInvitations.includes(inv.id) ? styles.unread : ''}`} onClick={() => handleInvClick(inv)}>
                    <div className={styles.avatar}>
                      {isImageUrl(inv.hostAvatar) ? (
                        <img src={inv.hostAvatar} alt={inv.hostName || "Host"} className={styles.avatarImg} />
                      ) : (
                        <DefaultAvatar />
                      )}
                    </div>
                    <div className={styles.content}>
                      <div>
                        <span 
                          className={styles.actorName}
                          onClick={(e) => { e.stopPropagation(); navigate(`/profile/${getUserById(inv.hostId)?.username || inv.hostId}`); }}
                          style={{ cursor: 'pointer' }}
                        >
                          {inv.hostName}
                        </span>
                        {' '}
                        <span className={styles.actionText}>invited you to <strong>{inv.title}</strong></span>
                      </div>
                      <div className={styles.invitationActions}>
                        <button 
                          className={styles.acceptBtn}
                          onClick={(e) => { e.stopPropagation(); joinCrewActivity(inv.id); }}
                        >
                          Accept
                        </button>
                        <button 
                          className={styles.declineBtn}
                          onClick={(e) => { e.stopPropagation(); declineCrewInvitation(inv.id); }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : (
            groupedNotifications.length === 0 ? (
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
            ) : (
              groupedNotifications.map(group => (
                <div key={group.key} className={styles.group}>
                  <h2 className={styles.groupTitle}>{group.title}</h2>
                  <div className={styles.groupItems}>
                    {group.items.map(notif => {
                      const actor = resolveActor(notif.actorId);
                      const isFollow = notif.type === 'follow';
                      const targetUsername = actor.username || (actor.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                      const timeStr = timeAgo(notif.createdAt)
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
                              <DefaultAvatar />
                            )}
                          </div>

                          <div className={styles.content}>
                            <div className={styles.textRow}>
                              <span 
                                className={styles.actorName}
                                onClick={(e) => {
                                  if (actor.username) {
                                    e.stopPropagation();
                                    navigate(`/profile/${actor.username}`);
                                  }
                                }}
                                style={{ cursor: actor.username ? 'pointer' : 'default' }}
                              >
                                {actor.name}
                              </span>
                              {' '}
                              <span className={styles.text}>{notif.text}</span>
                              {' '}
                              <span className={styles.time}>• {timeStr}</span>
                            </div>
                            {notif.type === 'ACTIVITY_JOIN_REQUEST' && (
                              <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                                <button 
                                  style={{ padding: '6px 16px', background: 'var(--color-primary)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 'bold' }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    acceptJoinRequest(notif.activityId, notif.actorId);
                                    dismissNotification(notif.id);
                                  }}
                                >
                                  Accept
                                </button>
                                <button 
                                  style={{ padding: '6px 16px', background: 'transparent', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 'bold' }}
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

                          <div className={styles.actionSlot}>
                            {isFollow ? (
                              <FollowButton targetUsername={targetUsername} size="sm" />
                            ) : (
                              <div className={styles.previewImg} />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )
          )}
        </div>
      </div>
    </main>
  );
}
