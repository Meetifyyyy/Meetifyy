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
import { requestOpenInstantMatchChat } from '@features/instant-match/context/InstantMatchContext';
import { isInstantChatNotification } from '@shared/utils/instantChatRouting';
import {
  INVITE_STATUS,
  inviteFromNotification,
  patchInviteNotification,
  resolveInviteStatus,
} from '../utils/inviteLifecycle';

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
  // Separate server-filtered feed backing the Invitations tab.
  const inviteFeed = useNotifications({ type: 'ACTIVITY_INVITE' });
  // getUserById was defined as exactly `users[id] || null` over this same map.
  const usersMap = useUsersMap();
  const getUserById = (id) => usersMap[id] || null;
  const crewActivities = useCrewActivities();
  const { joinCrewActivity, declineCrewInvitation } = useCrewActions();
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
  const loadedNotifications = notifications;

  const { data: pendingInvitations = [] } = useQuery({
    queryKey: ['activity-pending-invitations'],
    queryFn: () => activitiesApi.getPendingInvitations(),
    staleTime: 10_000,
    enabled: !!currentUser?.id,
  });

  // The Invitations tab pages over ACTIVITY_INVITE notifications on the SERVER
  // (`type=ACTIVITY_INVITE`), not over whatever invite rows happen to be inside
  // the first pages of the main feed.
  //
  // The pending-invitations endpoint cannot back this tab: it is pending-only by
  // definition, so an invite vanished from it the instant it was answered — the
  // original bug. The notification row is the persisted record of the invite AND
  // its outcome, so it is the only source that can show accepted / declined /
  // cancelled / expired. Filtering server-side (rather than merging two lists on
  // the client) means paging, refresh and every client agree, and the database
  // stays the single source of truth.
  //
  // Pending invitations with no notification row at all — an invite whose
  // notification the user deleted — are still merged in so nothing actionable
  // is unreachable.
  // Invites answered in this session: invitationId -> { status, activityId, row }.
  // Cleared on failure; superseded by the server's own value once it lands.
  const [settledInvites, setSettledInvites] = useState({});

  const inviteNotifications = useMemo(
    () => (inviteFeed.notifications || []).map(inviteFromNotification),
    [inviteFeed.notifications],
  );

  const invitations = useMemo(() => {
    const rows = [];
    const seenActivities = new Set();

    for (const inv of inviteNotifications) {
      if (!inv.activityId || seenActivities.has(inv.activityId)) continue;
      seenActivities.add(inv.activityId);
      rows.push(inv);
    }

    for (const inv of pendingInvitations) {
      if (seenActivities.has(inv.activityId)) continue;
      seenActivities.add(inv.activityId);
      rows.push(inv);
    }

    // Answers taken in THIS session are applied last and win.
    //
    // Neither source can be relied on to carry the answer back immediately: the
    // pending endpoint drops the invite the moment it stops being pending, and
    // the notification row is written asynchronously. Without this overlay the
    // row either flipped back to Pending on the next refetch or disappeared
    // outright — which is what made Accept/Decline look like it did nothing.
    // The overlay only ever reflects an answer the server has confirmed (or is
    // confirming), and it is dropped again if the request fails.
    const withAnswers = rows.map(row => {
      const settled =
        settledInvites[row.id] ||
        Object.values(settledInvites).find(s => s.activityId && s.activityId === row.activityId);
      if (!settled) return row;
      // The overlay fills a gap, it does not override the server: once the row
      // carries a terminal status of its own (the answer came back, or the host
      // cancelled in the meantime) that value wins.
      if (resolveInviteStatus(row) !== INVITE_STATUS.PENDING) return row;
      // Copied, never mutated — `row` may be an object owned by the query cache.
      return { ...row, lifecycleStatus: settled.status };
    });

    const known = new Set(withAnswers.map(r => r.id));
    for (const [invitationId, settled] of Object.entries(settledInvites)) {
      // Both sources have already let go of it; keep the row itself so the
      // outcome stays on screen rather than vanishing mid-interaction.
      if (!known.has(invitationId) && settled.row) {
        withAnswers.push({ ...settled.row, lifecycleStatus: settled.status });
      }
    }

    return withAnswers.sort(
      (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(),
    );
  }, [inviteNotifications, pendingInvitations, settledInvites]);

  // Answering an invite settles it in place: the row STAYS on screen and flips
  // to Accepted / Declined on the click, matching what the server is about to
  // persist on the same notification.
  //
  // The row is never removed from anything here. It is recorded in
  // `settledInvites` (which the list memo applies over both sources) and
  // patched into every notification cache entry, so the outcome shows whether
  // the row came from the notification feed or from the pending endpoint.
  const settleInvitationOptimistically = async (invitationId, nextStatus) => {
    await queryClient.cancelQueries({ queryKey: ['activity-pending-invitations'] });
    await queryClient.cancelQueries({ queryKey: ['notifications'] });

    const previousPending = queryClient.getQueryData(['activity-pending-invitations']);
    // Every ['notifications', ...] entry, not just the main feed — the
    // Invitations tab has its own, and restoring only one would leave the two
    // disagreeing after a failure.
    const previousNotifications = queryClient.getQueriesData({ queryKey: ['notifications'] });

    const row = invitations.find(i => i.id === invitationId) || null;
    setSettledInvites(prev => ({
      ...prev,
      [invitationId]: { status: nextStatus, activityId: row?.activityId, row },
    }));

    patchInviteNotification(queryClient, {
      invitationId,
      activityId: row?.activityId,
      status: nextStatus,
    });

    return { previousPending, previousNotifications, invitationId };
  };

  const restoreInvitations = (_err, _vars, ctx) => {
    if (ctx?.previousPending !== undefined) {
      queryClient.setQueryData(['activity-pending-invitations'], ctx.previousPending);
    }
    for (const [key, data] of ctx?.previousNotifications || []) {
      queryClient.setQueryData(key, data);
    }
    // The answer did not stick, so the row goes back to offering the choice.
    if (ctx?.invitationId) {
      setSettledInvites(prev => {
        const next = { ...prev };
        delete next[ctx.invitationId];
        return next;
      });
    }
    showToast('Something went wrong. Please try again.', 'error');
  };

  const acceptMutation = useMutation({
    mutationFn: (invitationId) => activitiesApi.acceptInvitation(invitationId),
    onMutate: (invitationId) => settleInvitationOptimistically(invitationId, INVITE_STATUS.ACCEPTED),
    onError: restoreInvitations,
    // Accepting already performs the join server-side, so the user lands on the
    // activity as a participant — there is no second "I'm in" step. The detail
    // entry is refetched BEFORE navigating so the page cannot paint from a
    // pre-join cached copy and offer to join an activity the user is already
    // in. A failed acceptance never reaches here, so it never redirects.
    onSuccess: async (res) => {
      queryClient.invalidateQueries({ queryKey: ['activities'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      const activityId = res?.activityId;
      if (!activityId) return;

      // Bounded: a slow or failing refetch must not strand the user on the
      // notifications page — the detail page revalidates on mount anyway.
      await queryClient
        .fetchQuery({
          queryKey: ['activity', activityId],
          queryFn: () => activitiesApi.getById(activityId),
        })
        .catch(() => {});

      navigate(`/crew/${activityId}`, { state: { from: '/notifications' } });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['activity-pending-invitations'] });
    },
  });

  const declineMutation = useMutation({
    mutationFn: (invitationId) => activitiesApi.declineInvitation(invitationId),
    onMutate: (invitationId) => settleInvitationOptimistically(invitationId, INVITE_STATUS.DECLINED),
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

  // Auto-mark all invitations as read the moment the user opens the tab
  useEffect(() => {
    if (activeTab !== 'invitations' || invitations.length === 0) return;
    const unread = invitations.filter(i => !readInvitations.includes(i.id));
    if (unread.length === 0) return;
    const updated = [...new Set([...readInvitations, ...unread.map(i => i.id)])];
    setReadInvitations(updated);
    localStorage.setItem('read_invitations', JSON.stringify(updated));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, invitations]);

  const error = null;
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

    // Moderation notices route by what still exists.
    //
    // A removal notice must NOT open the content it is about — that content is
    // exactly what was just deleted, so the link lands on a not-found page and
    // reads as a second failure on top of the bad news. The community is the
    // thing that still exists and the place the decision came from.
    const systemKind = notif.metadata?.kind;
    if (systemKind === 'content_removed' || systemKind === 'moderator_promotion') {
      const communityId = safeId(notif.metadata?.communityId);
      if (communityId) {
        navigate(`/communities/${communityId}`, { state: { from: '/notifications' } });
      }
      // A personal post removed by no community has nowhere useful to go, so
      // the row stays put rather than bouncing the reader somewhere arbitrary.
      return;
    }

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
        // `chatType` decides the surface. An Instant Match message belongs to
        // the Instant Match overlay, not to Messages — routing it by
        // conversation id sent the user into a section that conversation is
        // deliberately not listed in, and made the temporary match look like a
        // normal thread. The overlay resolves the user's live session itself,
        // which is why no id is needed (and why none is sent).
        if (isInstantChatNotification(notif)) {
          requestOpenInstantMatchChat();
        } else if (notif.entityId) {
          navigate(`/messages/${notif.entityId}`, { state: { from: '/notifications' } });
        }
        break;

      // Someone joined the recipient's activity — open that activity.
      case 'JOIN_REQUEST':
      case 'ACTIVITY_JOIN': {
        const activityId = notif.entityId || notif.metadata?.activityId;
        if (activityId) {
          navigate(`/crew/${activityId}`, { state: { from: '/notifications' } });
        }
        break;
      }

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

  // The tab badge counts only invites that still need an answer. A settled row
  // is a record, and badging history would make the number never reach zero.
  const unreadInvCount = invitations.filter(
    i => resolveInviteStatus(i) === INVITE_STATUS.PENDING && !readInvitations.includes(i.id),
  ).length;

  const headerTabs = useMemo(() => [
    { id: 'all', label: 'All Notifications' },
    { 
      id: 'invitations', 
      label: (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
          Invitations
          {unreadInvCount > 0 && (
            <span className={styles.tabBadge}>
              {unreadInvCount}
            </span>
          )}
        </span>
      )
    }
  ], [unreadInvCount]);

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
          {(activeTab === 'invitations' ? inviteFeed.isLoading : isLoading) ? (
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
              busyInvitationId={
                acceptMutation.isPending
                  ? acceptMutation.variables
                  : declineMutation.isPending
                    ? declineMutation.variables
                    : null
              }
              onNavigateHost={(hostId) => navigate(`/profile/${getUserById(hostId)?.username || hostId}`)}
              onViewActivity={handleInvClick}
              pageStyles={styles}
            />
          ) : (
            <NotificationList
              groupedNotifications={groupedNotifications}
              timeAgo={timeAgo}
              onNotifClick={handleClick}
              getUserById={getUserById}
              pageStyles={styles}
              scrollRef={pageRef}
            />
          )}
          {activeTab === 'invitations' && inviteFeed.hasNextPage && (
            <div style={{ padding: '0.5rem 0' }}>
              <button
                onClick={() => inviteFeed.fetchNextPage()}
                disabled={inviteFeed.isFetchingNextPage}
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  margin: '1rem 0',
                  background: 'var(--color-bg-white)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '8px',
                  color: 'var(--color-text-main)',
                  fontWeight: 600,
                  cursor: 'pointer',
                  textAlign: 'center',
                }}
              >
                {inviteFeed.isFetchingNextPage ? 'Loading…' : 'Load More'}
              </button>
            </div>
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
                    color: 'var(--color-text-main)',
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
