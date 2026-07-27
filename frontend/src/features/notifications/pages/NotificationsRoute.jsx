import { useMemo, useState, useEffect, useRef } from 'react';
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

import { NotifRowSkeleton } from '../components/skeletons/NotificationsSkeleton';

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
  const loadMoreRef = useRef(null);
  const hasMarkedReadRef = useRef(false);

  // Automatically mark all notifications as read once when opening notifications page
  useEffect(() => {
    if (!hasMarkedReadRef.current && notifications && notifications.length > 0) {
      const hasUnread = notifications.some(n => !n.read && !n.readAt);
      if (hasUnread) {
        hasMarkedReadRef.current = true;
        markAllRead();
      }
    }
  }, [notifications, markAllRead]);

  // Infinite scroll trigger for loading chunks
  useEffect(() => {
    if (!loadMoreRef.current || !hasNextPage || isFetchingNextPage || activeTab === 'invitations') return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          fetchNextPage();
        }
      },
      { rootMargin: '200px' }
    );

    observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, activeTab]);


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
            <div className={styles.groupItems}>
              <NotifRowSkeleton />
              <NotifRowSkeleton />
              <NotifRowSkeleton />
              <NotifRowSkeleton />
              <NotifRowSkeleton />
              <NotifRowSkeleton />
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
          {activeTab !== 'invitations' && isFetchingNextPage && !isLoading && (
            <div className={styles.groupItems} style={{ marginTop: '0.75rem' }}>
              <NotifRowSkeleton />
              <NotifRowSkeleton />
              <NotifRowSkeleton />
            </div>
          )}
          {activeTab !== 'invitations' && hasNextPage && (
            <div ref={loadMoreRef} style={{ padding: '0.5rem 0' }}>
              {!isFetchingNextPage && (
                <button
                  onClick={() => fetchNextPage()}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    margin: '1rem 0',
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
                  Load More
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
