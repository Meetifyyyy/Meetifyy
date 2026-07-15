import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotifications } from '@shared/context/NotificationContext';
import { useAuth } from '@shared/context/AuthContext';
import { useData } from '@shared/context/DataContext';
import { useSimulatedFetch } from '@shared/hooks/useSimulatedFetch';
import { useSmartBack } from '@shared/hooks/useSmartBack';
import Skeleton from '@shared/components/skeletons/Skeleton';
import { ErrorState } from '@shared/components/ui/StateViews';
import PageHeader from '@layout/PageHeader';

import NotificationList from '../components/NotificationList';
import InvitationList from '../components/InvitationList';
import styles from './NotificationsRoute.module.css';

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
  const { notifications, markAsRead, markAllRead, clearAll, timeAgo, dismissNotification } = useNotifications();
  const { getUserById, crewActivities, joinCrewActivity, declineCrewInvitation, acceptJoinRequest, rejectJoinRequest } = useData();
  const navigate = useNavigate();
  const goBack = useSmartBack();

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

  const { isLoading, data: loadedNotifications, error, retry } = useSimulatedFetch(notifications, 350);

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
              <NotificationRowSkeleton />
              <NotificationRowSkeleton />
              <NotificationRowSkeleton />
              <NotificationRowSkeleton />
              <NotificationRowSkeleton />
              <NotificationRowSkeleton />
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
              resolveActor={resolveActor}
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
              pageStyles={styles}
            />
          )}
        </div>
      </div>
    </main>
  );
}
