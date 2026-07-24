import { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotifications } from '@shared/hooks/useNotifications';
import { useAuth } from '@shared/context/AuthContext';
import { timeAgo } from '@shared/utils/time';
import { useSmartBack } from '@shared/hooks/useSmartBack';
import Skeleton from '@shared/components/skeletons/Skeleton';
import { ErrorState } from '@shared/components/ui/StateViews';
import PageHeader from '@layout/PageHeader';

import NotificationList from '../components/NotificationList';
import InvitationList from '../components/InvitationList';
import styles from './NotificationsRoute.module.css';
import { useData } from '@shared/hooks/useData';


function NotificationRowSkeleton() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.75rem 1.25rem', borderBottom: '1px solid var(--color-border-light)', pointerEvents: 'none', background: 'var(--color-bg-white)' }}>
      <div style={{ width: '34px', height: '34px', borderRadius: '50%', overflow: 'hidden', flexShrink: 0 }}>
        <Skeleton type="circle" width="34px" height="34px" />
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
        <Skeleton type="text" width="60%" height="1.1rem" style={{ marginBottom: '0.4rem' }} />
        <Skeleton type="text" width="40%" height="0.8rem" />
      </div>
      <div style={{ flexShrink: 0, minWidth: '80px', display: 'flex', justifyContent: 'flex-end' }}>
        <Skeleton type="rect" width="70px" height="32px" style={{ borderRadius: '100px' }} />
      </div>
    </div>
  );
}

export default function NotificationsRoute() {
  const [activeTab, setActiveTab] = useState('all');
  const { currentUser } = useAuth();
  const {
    notifications,
    markAsRead,
    markAllRead,
    dismissNotification,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading
  } = useNotifications();
  const { getUserById, crewActivities, joinCrewActivity, declineCrewInvitation, acceptJoinRequest, rejectJoinRequest } = useData();
  const navigate = useNavigate();
  const goBack = useSmartBack();

  // Automatically mark all notifications as read when opening notifications page
  useEffect(() => {
    markAllRead();
  }, []);

  const invitations = useMemo(() => {
    return crewActivities ? crewActivities.filter(a => 
      a.invitedUsers?.includes(currentUser?.id)
    ) : [];
  }, [crewActivities, currentUser?.id]);

  const [readInvitations, setReadInvitations] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('read_invitations') || '[]');
    } catch {
      return [];
    }
  });

  const handleInvClick = (inv) => {
    if (!readInvitations.includes(inv.id)) {
      const updated = [...readInvitations, inv.id];
      setReadInvitations(updated);
      localStorage.setItem('read_invitations', JSON.stringify(updated));
    }
    navigate(`/crew/${inv.id}`, { state: { activity: inv } });
  };

  const error = null;
  const loadedNotifications = notifications;
  const retry = () => {};

  const SAFE_ID = /^[a-zA-Z0-9_-]{1,64}$/;
  const SAFE_USERNAME = /^[a-zA-Z0-9_.]{1,50}$/;
  const safeId = (v) => (v && SAFE_ID.test(v) ? v : null);
  const safeUsername = (v) => (v && SAFE_USERNAME.test(v) ? v : null);

  const handleClick = (notif) => {
    markAsRead(notif.id);

    const type = (notif.type || '').toUpperCase();
    const actorUsername = notif.actor?.username || notif.metadata?.username || notif.targetUsername;
    const postId = notif.metadata?.postId || (notif.entityType === 'POST' ? notif.entityId : null) || notif.postId;
    const commentId = notif.metadata?.commentId || (notif.entityType === 'COMMENT' ? notif.entityId : null) || notif.commentId;

    switch (type) {
      case 'FOLLOW':
        if (actorUsername) {
          navigate(`/profile/${actorUsername}`);
        } else if (notif.entityId) {
          navigate(`/profile/${notif.entityId}`);
        }
        break;

      case 'LIKE':
      case 'POST_LIKE':
        if (postId) {
          navigate(`/post/${postId}`);
        } else if (notif.entityId) {
          navigate(`/post/${notif.entityId}`);
        }
        break;

      case 'COMMENT':
      case 'COMMENT_LIKE':
        if (postId && commentId) {
          navigate(`/post/${postId}#comment-${commentId}`);
        } else if (postId) {
          navigate(`/post/${postId}`);
        } else if (notif.entityId) {
          navigate(`/post/${notif.entityId}`);
        }
        break;

      case 'MENTION':
        if (postId) {
          navigate(`/post/${postId}`);
        } else if (notif.metadata?.conversationId || notif.convId) {
          navigate(`/messages/${notif.metadata?.conversationId || notif.convId}`);
        } else if (notif.entityId) {
          navigate(`/post/${notif.entityId}`);
        }
        break;

      case 'MESSAGE':
        if (notif.entityId) {
          navigate(`/messages/${notif.entityId}`);
        }
        break;

      case 'JOIN_REQUEST':
      case 'ACTIVITY_JOIN_REQUEST':
        if (notif.entityId) {
          navigate(`/crew/${notif.entityId}?discussion=1`);
        }
        break;

      default:
        if (actorUsername) {
          navigate(`/profile/${actorUsername}`);
        } else if (postId) {
          navigate(`/post/${postId}`);
        } else {
          navigate('/home');
        }
        break;
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
      // For MVP, created_at comes as string from backend, parse to ms
      const createdAtMs = new Date(notif.createdAt).getTime();
      const diff = now - createdAtMs;
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
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3.5rem 1rem' }}>
              <div 
                style={{
                  width: '32px',
                  height: '32px',
                  border: '3px solid rgba(var(--color-primary-rgb), 0.15)',
                  borderTopColor: 'var(--color-primary)',
                  borderRadius: '50%',
                  animation: 'spin 0.8s linear infinite'
                }}
              />
              <style>{`
                @keyframes spin {
                  0% { transform: rotate(0deg); }
                  100% { transform: rotate(360deg); }
                }
              `}</style>
            </div>
          ) : error ? (
            <ErrorState onRetry={retry} />
          ) : activeTab === 'invitations' ? (
            <InvitationList
              invitations={invitations}
              readInvitations={readInvitations}
              onAccept={joinCrewActivity}
              onDecline={declineCrewInvitation}
              onNavigateHost={(hostId) => navigate(`/profile/${getUserById(hostId)?.username || hostId}`)}
              onViewActivity={handleInvClick}
              pageStyles={styles}
            />
          ) : (
            <NotificationList
              groupedNotifications={groupedNotifications}
              timeAgo={timeAgo}
              onNotifClick={handleClick}
              onAcceptJoinRequest={(activityId, actorId, notifId) => {
                acceptJoinRequest(activityId, actorId);
                dismissNotification(notifId);
              }}
              onRejectJoinRequest={(activityId, actorId, notifId) => {
                rejectJoinRequest(activityId, actorId);
                dismissNotification(notifId);
              }}
              getUserById={getUserById}
              pageStyles={styles}
            />
          )}
          {activeTab !== 'invitations' && hasNextPage && (
            <button
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
              style={{
                width: '100%',
                padding: '0.75rem',
                margin: '1.5rem 0',
                background: 'var(--color-bg-white)',
                border: '1px solid var(--color-border)',
                borderRadius: '8px',
                color: 'var(--color-text)',
                fontWeight: 600,
                cursor: 'pointer',
                textAlign: 'center',
                transition: 'all 0.2s',
              }}
            >
              {isFetchingNextPage ? 'Loading more...' : 'Load More'}
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
