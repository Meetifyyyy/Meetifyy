import { useMemo, useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUrlState } from '@shared/hooks/useUrlState';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNotifications } from '@shared/hooks/useNotifications';
import { useAuth } from '@shared/context/AuthContext';
import { activitiesApi } from '@shared/api/apiClient';
import { showToast } from '@shared/utils/toast';
import { timeAgo } from '@shared/utils/time';
import { useSmartBack } from '@shared/hooks/useSmartBack';
import Skeleton from '@shared/components/skeletons/Skeleton';
import { ErrorState } from '@shared/components/ui/StateViews';
import PageHeader from '@layout/PageHeader';

import NotificationList from '../components/NotificationList';
import InvitationList from '../components/InvitationList';
import styles from './NotificationsRoute.module.css';
import { useUsersMap } from '@shared/hooks/useUsersMap';
import { useCrewActivities, useCrewActions } from '@shared/hooks/useCrew';

import { NotifRowSkeleton } from '../components/skeletons/NotificationsSkeleton';

export default function NotificationsRoute() {
  // ?tab=invitations survives a reload and gives Back a step inside the module
  // instead of dropping the user straight out of Notifications.
  const [activeTab, setActiveTab] = useUrlState('tab', 'all', {
    allowed: ['all', 'invitations'],
    push: true,
  });
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
  // getUserById was defined as exactly `users[id] || null` over this same map.
  const usersMap = useUsersMap();
  const getUserById = (id) => usersMap[id] || null;
  const crewActivities = useCrewActivities();
  const { joinCrewActivity, declineCrewInvitation, acceptJoinRequest, rejectJoinRequest } = useCrewActions();
  const navigate = useNavigate();
  const loadMoreRef = useRef(null);
  const hasMarkedReadRef = useRef(false);
  const pageRef = useRef(null);

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


  const queryClient = useQueryClient();

  const { data: invitations = [] } = useQuery({
    queryKey: ['activity-pending-invitations'],
    queryFn: () => activitiesApi.getPendingInvitations(),
    staleTime: 10_000,
    enabled: !!currentUser?.id,
  });

  // Both mutations drop the invitation from the pending list immediately rather
  // than waiting on a refetch, so Accept/Decline feel instant. The snapshot is
  // restored if the request fails, and the authoritative refetch still runs on
  // settle.
  const removeInvitationOptimistically = async (invitationId) => {
    await queryClient.cancelQueries({ queryKey: ['activity-pending-invitations'] });
    const previous = queryClient.getQueryData(['activity-pending-invitations']);
    queryClient.setQueryData(['activity-pending-invitations'], (old) =>
      Array.isArray(old) ? old.filter((i) => i.id !== invitationId) : old,
    );
    return { previous };
  };

  const restoreInvitations = (_err, _vars, ctx) => {
    if (ctx?.previous !== undefined) {
      queryClient.setQueryData(['activity-pending-invitations'], ctx.previous);
    }
    showToast('Something went wrong. Please try again.', 'error');
  };

  const acceptMutation = useMutation({
    mutationFn: (invitationId) => activitiesApi.acceptInvitation(invitationId),
    onMutate: removeInvitationOptimistically,
    onError: restoreInvitations,
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['activities'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      if (res?.activityId) {
        navigate(`/crew/${res.activityId}`, { state: { from: '/notifications' } });
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['activity-pending-invitations'] });
    },
  });

  const declineMutation = useMutation({
    mutationFn: (invitationId) => activitiesApi.declineInvitation(invitationId),
    onMutate: removeInvitationOptimistically,
    onError: restoreInvitations,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['activity-pending-invitations'] });
    },
  });

  const [readInvitations, setReadInvitations] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('read_invitations') || '[]');
    } catch {
      return [];
    }
  });

  const handleInvClick = (inv) => {
    const actId = inv.activityId || inv.id;
    if (!readInvitations.includes(inv.id)) {
      const updated = [...readInvitations, inv.id];
      setReadInvitations(updated);
      localStorage.setItem('read_invitations', JSON.stringify(updated));
    }
    navigate(`/crew/${actId}`, { state: { activity: inv, from: '/notifications' } });
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
          navigate(`/profile/${actorUsername}`, { state: { from: '/notifications' } });
        } else if (notif.entityId) {
          navigate(`/profile/${notif.entityId}`, { state: { from: '/notifications' } });
        }
        break;

      case 'LIKE':
      case 'POST_LIKE':
        if (postId) {
          navigate(`/post/${postId}`, { state: { from: '/notifications' } });
        } else if (notif.entityId) {
          navigate(`/post/${notif.entityId}`, { state: { from: '/notifications' } });
        }
        break;

      case 'COMMENT':
      case 'COMMENT_LIKE':
        if (postId && commentId) {
          navigate(`/post/${postId}#comment-${commentId}`, { state: { from: '/notifications' } });
        } else if (postId) {
          navigate(`/post/${postId}`, { state: { from: '/notifications' } });
        } else if (notif.entityId) {
          navigate(`/post/${notif.entityId}`, { state: { from: '/notifications' } });
        }
        break;

      case 'MENTION':
        if (postId && commentId) {
          navigate(`/post/${postId}#comment-${commentId}`, { state: { from: '/notifications' } });
        } else if (postId) {
          navigate(`/post/${postId}`, { state: { from: '/notifications' } });
        } else if (notif.metadata?.conversationId || notif.convId) {
          navigate(`/messages/${notif.metadata?.conversationId || notif.convId}`, { state: { from: '/notifications' } });
        } else if (notif.entityId) {
          navigate(`/post/${notif.entityId}`, { state: { from: '/notifications' } });
        }
        break;

      case 'MESSAGE':
        if (notif.entityId) {
          navigate(`/messages/${notif.entityId}`, { state: { from: '/notifications' } });
        }
        break;

      case 'JOIN_REQUEST':
      case 'ACTIVITY_JOIN_REQUEST':
        if (notif.entityId) {
          navigate(`/crew/${notif.entityId}?discussion=1`, { state: { from: '/notifications' } });
        }
        break;

      case 'ACTIVITY_INVITE':
        setActiveTab('invitations');
        break;

      default:
        if (actorUsername) {
          navigate(`/profile/${actorUsername}`, { state: { from: '/notifications' } });
        } else if (postId) {
          navigate(`/post/${postId}`, { state: { from: '/notifications' } });
        } else {
          navigate('/home', { replace: true });
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
      if (notif.type === 'ACTIVITY_INVITE') return;

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
      <div className={styles.page} ref={pageRef}>
        <div className={styles.headerArea}>
          <PageHeader
            title="Notifications"
            backPath="/home"
            tabs={headerTabs}
            activeTab={activeTab}
            onTabChange={setActiveTab}
          />
        </div>

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
              onAccept={(invId) => acceptMutation.mutate(invId)}
              onDecline={(invId) => declineMutation.mutate(invId)}
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
              scrollRef={pageRef}
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
