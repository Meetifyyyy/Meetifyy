import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import FollowButton from '@shared/components/ui/FollowButton';
import CalendarIcon from '@shared/components/ui/CalendarIcon';
import { useNotifications } from '@shared/hooks/useNotifications';
import { timeAgo } from '@shared/utils/time';
import { showToast } from '@shared/utils/toast';
import Avatar from '@shared/components/avatar/Avatar';
import { canSeeOnlineStatus } from '@shared/utils/presence';
import styles from './RightPanel.module.css';
import { useQuery } from '@tanstack/react-query';
import { usersApi, activitiesApi, getMediaUrl } from '@shared/api/apiClient';
import { useAuth } from '@shared/context/AuthContext';
import { useUsersMap } from '@shared/hooks/useUsersMap';
import { useCrewActivities } from '@shared/hooks/useCrew';

export default function RightPanel({ children, className = '' }) {
  return <aside className={`${styles.rightPanel} ${className}`.trim()}>{children}</aside>;
}

export function NotificationsActivity() {
  const { notifications, isLoading } = useNotifications();
  const users = useUsersMap();
  const navigate = useNavigate();
  const { DEFAULT_ACTIVITY_COVERS, getDefaultActivityCover } = React.useMemo(() => {
    // Inline the same deterministic cover logic used across the app
    const covers = [
      'https://images.unsplash.com/photo-1540575467063-178a50c2df87?q=80&w=800&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?q=80&w=800&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1511556532299-8f662fc26c06?q=80&w=800&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1505373877841-8d25f7d46678?q=80&w=800&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1528605248644-14dd04022da1?q=80&w=800&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1551818255-e6e10975bc17?q=80&w=800&auto=format&fit=crop',
    ];
    const fn = (idOrTitle = '') => {
      let hash = 0;
      const str = String(idOrTitle || '');
      for (let i = 0; i < str.length; i++) { hash = (hash << 5) - hash + str.charCodeAt(i); hash |= 0; }
      return covers[Math.abs(hash) % covers.length];
    };
    return { DEFAULT_ACTIVITY_COVERS: covers, getDefaultActivityCover: fn };
  }, []);

  const displayNotifs = notifications.slice(0, 4);

  return (
    <div className={styles.panelCard}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', paddingLeft: '0.35rem', paddingRight: '0.25rem' }}>
        <h3 className={styles.panelTitle} style={{ marginBottom: 0 }}>Recent Activity</h3>
        <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', cursor: 'pointer', fontWeight: 500 }} onClick={() => navigate('/notifications')}>See all</span>
      </div>
      
      {isLoading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem 0' }}>
          <div 
            style={{
              width: '24px',
              height: '24px',
              border: '2.5px solid rgba(var(--color-primary-rgb), 0.15)',
              borderTopColor: 'var(--color-primary)',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite'
            }}
          />
        </div>
      ) : displayNotifs.length === 0 ? (
        <div style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', textAlign: 'center', padding: '1rem 0' }}>
          No recent activity.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {displayNotifs.map((n) => {
            const actorId = n.actor?.id || n.actorId || n.metadata?.actorId;
            const actorUsername = n.actor?.username || n.metadata?.actorUsername;
            const liveUser = (users && actorId ? users[actorId] : null) || 
                             (users && actorUsername ? Object.values(users).find(u => u.username === actorUsername) : null);

            const actorName = liveUser?.displayName || liveUser?.username || n.actor?.displayName || n.actor?.username || n.metadata?.actorDisplayName || n.metadata?.actorName || n.metadata?.actorUsername || 'Someone';
            const actorAvatar = liveUser?.avatarUrl || liveUser?.avatar || n.actor?.avatarUrl || n.actor?.avatar || n.metadata?.actorAvatarUrl || n.metadata?.actorAvatar || '';
            const targetUsername = liveUser?.username || n.actor?.username || n.metadata?.actorUsername || '';

            const notifType = (n.type || '').toLowerCase();
            const isFollow = notifType === 'follow';
            // Strictly "someone joined your activity" — exclude invites
            const isActivityJoin = notifType === 'join_request' || notifType === 'activity_join';
            // "Someone invited you to join an activity"
            const isActivityInvite = notifType === 'activity_invite';
            const postMedia = (!isActivityJoin && !isActivityInvite) ? (n.metadata?.postMedia || n.metadata?.mediaUrl || n.metadata?.postImage || n.metadata?.thumbnailUrl || null) : null;

            const activityName = n.metadata?.activityName || n.metadata?.activityTitle || n.title || 'Activity';
            const activityImage = n.metadata?.activityImage;
            const activityCoverSrc = activityImage ? getMediaUrl(activityImage) : getDefaultActivityCover(activityName || n.entityId || '');
            const activityDate = n.metadata?.activityDate || n.metadata?.startDate || null;

            let bodyText = n.body || n.text || '';
            if (isActivityJoin) {
              bodyText = 'joined the activity.';
            } else if (isActivityInvite) {
              bodyText = 'invited you to join.';
            } else if (isFollow) {
              bodyText = 'started following you.';
            } else if (notifType === 'like') {
              bodyText = 'liked your post.';
            } else if (notifType === 'comment_like') {
              bodyText = 'liked your comment.';
            } else if (notifType === 'comment') {
              if (n.metadata?.isReply || bodyText.includes('replied to your comment:')) {
                bodyText = 'replied to your comment.';
              } else if (bodyText.includes('commented:')) {
                bodyText = bodyText.substring(bodyText.indexOf('commented:')).trim();
              } else {
                bodyText = 'commented on your post.';
              }
            } else if (notifType === 'mention') {
              bodyText = 'mentioned you.';
            } else if (notifType === 'message') {
              bodyText = 'sent you a message.';
            } else if (bodyText.startsWith(actorName)) {
              bodyText = bodyText.substring(actorName.length).trim();
            }

            if (!bodyText) {
              bodyText = n.title || 'sent a notification.';
            }

            const timeStr = timeAgo(n.createdAt)
              .replace(' ago', '')
              .replace('just now', 'now')
              .replace(' seconds', 's')
              .replace(' second', 's')
              .replace(' minutes', 'm')
              .replace(' minute', 'm')
              .replace(' hours', 'h')
              .replace(' hour', 'h')
              .replace(' days', 'd')
              .replace(' day', 'd');

            const handleItemClick = () => {
              if (isActivityJoin || isActivityInvite) {
                const activityId = n.entityId || n.metadata?.activityId;
                if (activityId) { navigate(`/crew/${activityId}`, { state: { from: location.pathname } }); return; }
              }
              const postId = n.metadata?.postId || (n.entityType === 'POST' ? n.entityId : null);
              if (isFollow && targetUsername) {
                navigate(`/profile/${targetUsername}`, { state: { from: location.pathname } });
              } else if (postId) {
                navigate(`/post/${postId}`, { state: { from: location.pathname } });
              } else {
                navigate('/notifications', { state: { from: location.pathname } });
              }
            };

            return (
              <div 
                key={n.id} 
                className={styles.friendItem} 
                onClick={handleItemClick}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.65rem',
                  padding: (isActivityJoin || isActivityInvite) ? '0.6rem 0.25rem' : '0.5rem 0.25rem',
                  borderRadius: '10px',
                  cursor: 'pointer',
                  borderBottom: 'none',
                  overflow: 'visible',
                }}
              >
                {/* Left slot */}
                {(isActivityJoin || isActivityInvite) ? (
                  <div style={{ position: 'relative', width: '42px', height: '42px', flexShrink: 0 }}>
                    <img
                      src={activityCoverSrc}
                      alt=""
                      style={{ width: '42px', height: '42px', borderRadius: '10px', objectFit: 'cover', display: 'block' }}
                      onError={(e) => { e.target.onerror = null; e.target.src = DEFAULT_ACTIVITY_COVERS[0]; }}
                    />
                    {/* Calendar badge — bottom-right, matching CrewCard */}
                    <div style={{ position: 'absolute', bottom: '-7px', right: '-9px', zIndex: 2 }}>
                      <CalendarIcon
                        date={activityDate}
                        size="badge"
                        style={{ border: '2.5px solid var(--color-bg-white, #ffffff)', boxShadow: 'none' }}
                      />
                    </div>
                  </div>
                ) : (
                  <Avatar 
                    src={actorAvatar} 
                    name={actorName} 
                    size="38px" 
                  />
                )}
                
                {/* Text */}
                <div style={{ flex: 1, minWidth: 0, paddingLeft: (isActivityJoin || isActivityInvite) ? '6px' : 0 }}>
                  {(isActivityJoin || isActivityInvite) ? (
                    <>
                      <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--color-text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {activityName}
                        <span style={{ fontSize: '0.72rem', color: 'var(--color-text-light)', fontWeight: 400, marginLeft: '4px' }}>• {timeStr}</span>
                      </div>
                      <div style={{ fontSize: '0.79rem', color: 'var(--color-text-muted)', marginTop: '1px' }}>
                        <strong style={{ color: 'var(--color-text-main)', fontWeight: 600 }}>{actorName}</strong>
                        {' '}{isActivityInvite ? 'invited you to join.' : 'joined the activity.'}
                      </div>
                    </>
                  ) : (
                    <div style={{ fontSize: '0.82rem', lineHeight: 1.35, color: 'var(--color-text-muted)' }}>
                      <strong style={{ color: 'var(--color-text-main)', fontWeight: 600 }}>
                        {actorName}
                      </strong>{' '}
                      <span>{bodyText}</span>{' '}
                      <span style={{ fontSize: '0.75rem', color: 'var(--color-text-light)', whiteSpace: 'nowrap' }}>• {timeStr}</span>
                    </div>
                  )}
                </div>

                <div style={{ flexShrink: 0, marginLeft: '0.35rem', display: 'flex', alignItems: 'center' }}>
                  {isFollow && targetUsername ? (
                    <div onClick={(e) => e.stopPropagation()}>
                      <FollowButton 
                        targetUsername={targetUsername} 
                        size="sm" 
                        style={{ padding: '0.3rem 0.75rem', fontSize: '0.78rem', minWidth: '70px', height: '30px' }}
                      />
                    </div>
                  ) : postMedia ? (
                    <img src={getMediaUrl(postMedia)} alt="" style={{ width: '34px', height: '34px', borderRadius: '6px', objectFit: 'cover' }} />
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function OnlineFriends() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  // Server-computed: mutual connections who are currently online, respecting
  // each user's own presence-visibility settings. Replaces the old pattern of
  // fetching a page of "all users" (capped at 20, ordered by signup recency)
  // and re-deriving "is this a mutual, are they online" in JS — that scanned
  // the wrong population entirely and could show zero friends even when the
  // viewer had online mutuals outside that arbitrary recent-signup window.
  const { data: friends = [], isLoading } = useQuery({
    queryKey: ['online-friends', currentUser?.id],
    queryFn: () => usersApi.getOnlineFriends(6),
    enabled: !!currentUser?.id,
    staleTime: 15_000,
    // Presence changes in real time via sockets elsewhere in the app; a short
    // background refetch keeps this widget reasonably fresh without hammering
    // the endpoint on every focus/remount.
    refetchInterval: 30_000,
  });

  // Distinguish "still loading" from "genuinely no online friends" so the
  // card doesn't pop in after the fact (layout shift) or flash empty before
  // data arrives — while loading, hold the card's place with skeleton dots;
  // once resolved, collapse away entirely only if truly empty.
  if (!isLoading && friends.length === 0) return null;

  return (
    <div className={styles.panelCard}>
      <h3 className={styles.panelTitle} style={{ marginBottom: '1rem' }}>Online Friends</h3>
      <div className={styles.onlineFriendsContainer} style={{ gap: '0.5rem', justifyContent: 'flex-start' }}>
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', width: '56px' }}>
              <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'var(--color-bg-soft)', animation: 'skeletonPulse 1.5s ease-in-out infinite' }} />
              <div style={{ width: '36px', height: '9px', borderRadius: '4px', background: 'var(--color-bg-soft)', animation: 'skeletonPulse 1.5s ease-in-out infinite' }} />
            </div>
          ))
        ) : (
          friends.map((f) => (
            <div
              key={f.id}
              title={f.displayName || f.username}
              style={{
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '4px',
                width: '56px'
              }}
              onClick={() => f.username && navigate(`/profile/${f.username}`, { state: { from: location.pathname } })}
            >
              <Avatar
                src={f.avatar}
                name={f.displayName || f.username}
                size="48px"
                isOnline
              />
              <span style={{
                fontSize: '0.65rem',
                color: 'var(--color-text-muted)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                width: '100%',
                textAlign: 'center',
                lineHeight: '1.1'
              }}>
                {f.username.length > 8 ? f.username.slice(0, 7) + '...' : f.username}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function getStartsInLabel(act, index = 0, nowTime = Date.now()) {
  if (!act) return 'Starts soon';

  if (act.status === 'ENDED' || act.status === 'COMPLETED' || act.isEnded) {
    return 'Ended';
  }
  if (act.status === 'CANCELLED') {
    return 'Cancelled';
  }

  if (act.startsInLabel && !act.date && !act.startDate) return act.startsInLabel;

  try {
    const rawDate = act.startDate || act.date || act.createdAt;
    if (rawDate) {
      const targetDate = new Date(rawDate);
      if (isNaN(targetDate.getTime())) return 'Starts soon';

      if (act.time && typeof act.time === 'string') {
        const match = act.time.match(/(\d+):(\d+)\s*(AM|PM)?/i);
        if (match) {
          let h = parseInt(match[1], 10);
          const m = parseInt(match[2], 10);
          const ampm = match[3] ? match[3].toUpperCase() : null;
          if (ampm === 'PM' && h < 12) h += 12;
          if (ampm === 'AM' && h === 12) h = 0;
          targetDate.setHours(h, m, 0, 0);
        }
      }

      const startTime = targetDate.getTime();

      let endTime = null;
      if (act.endDate) {
        const parsedEnd = new Date(act.endDate).getTime();
        if (!isNaN(parsedEnd)) endTime = parsedEnd;
      }

      if (!endTime) {
        let durationHours = 2;
        if (act.duration) {
          const match = String(act.duration).match(/(\d+)/);
          if (match) durationHours = parseInt(match[1], 10);
        }
        endTime = startTime + durationHours * 60 * 60 * 1000;
      }

      if (nowTime >= endTime) {
        return 'Ended';
      }

      const diffMs = startTime - nowTime;

      if (diffMs > 0) {
        if (diffMs >= 24 * 60 * 60 * 1000) {
          const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
          const hours = Math.floor((diffMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
          return `Starts in ${days}d ${hours}hr`;
        } else if (diffMs >= 60 * 60 * 1000) {
          const hours = Math.floor(diffMs / (60 * 60 * 1000));
          const mins = Math.floor((diffMs % (60 * 60 * 1000)) / (60 * 1000));
          return `Starts in ${hours}hr ${mins}m`;
        } else {
          const mins = Math.floor(diffMs / (60 * 1000));
          const secs = Math.floor((diffMs % (60 * 1000)) / 1000);
          const secsStr = String(secs).padStart(2, '0');
          return `Starts in ${mins}m ${secsStr}s`;
        }
      } else {
        return `Already started`;
      }
    }
  } catch (e) {
    // fallback
  }
  return `Starts soon`;
}

export function UpcomingEvents() {
  const crewActivities = useCrewActivities();
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [nowTime, setNowTime] = React.useState(Date.now());

  React.useEffect(() => {
    const timer = setInterval(() => {
      setNowTime(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const myActivities = useMemo(() => {
    if (!currentUser) return [];
    const now = new Date();
    return crewActivities
      .filter(a => {
        if (!a.participants?.includes(currentUser.id)) return false;
        
        let hasEnded = a.status === 'ENDED' || a.status === 'CANCELLED';
        const startRaw = a.startDate || a.date;
        const endRaw = a.endDate;
        
        if (!hasEnded) {
          if (endRaw) {
            const end = new Date(endRaw);
            if (!isNaN(end.getTime()) && now >= end) hasEnded = true;
          } else if (startRaw) {
            const start = new Date(startRaw);
            if (!isNaN(start.getTime())) {
              let durationHours = 1;
              if (a.duration) {
                const match = String(a.duration).match(/(\d+)/);
                if (match) durationHours = parseInt(match[1], 10);
              }
              const calculatedEnd = new Date(start.getTime() + durationHours * 60 * 60 * 1000);
              if (now >= calculatedEnd) hasEnded = true;
            }
          }
        }
        
        return !hasEnded;
      })
      .sort((a, b) => new Date(a.startDate || a.createdAt) - new Date(b.startDate || b.createdAt));
  }, [crewActivities, currentUser]);

  return (
    <div className={styles.panelCard}>
      <h3 className={styles.panelTitle}>My Upcoming Activities</h3>
      <div className={styles.activityList}>
        {myActivities.length === 0 ? (
          <p className={styles.emptyText}>No upcoming activities yet. Join one to get started!</p>
        ) : (
          myActivities.slice(0, 2).map((activity, i) => (
            <div key={activity.id} className={styles.eventItem} onClick={() => navigate(`/crew/${activity.id}`, { state: { activity, from: location.pathname } })}>
              <CalendarIcon date={activity.date} dateLabel={activity.dateLabel} />
              <div className={styles.eventDetail}>
                <div className={styles.eventName}>{activity.title}</div>
                <div className={styles.eventSub}>{getStartsInLabel(activity, i, nowTime)}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function UniversityEvents({ events, title = 'Ongoing Events', onViewAll }) {
  if (!events || events.length === 0) return null;

  return (
    <div className={styles.panelCard}>
      <h3 className={styles.panelTitle}>{title}</h3>
      {events.map((e, i) => {
        const dateParts = e.date.split(' ');
        const month = dateParts[0];
        const day = dateParts[1] || '';
        
        return (
          <div key={i} className={styles.eventItem}>
            <div className={styles.eventDate}>{month}<br /><span>{day}</span></div>
            <div className={styles.eventDetail}>
              <div className={styles.eventName}>{e.title}</div>
              <div className={styles.eventMeta}>{e.time} • {e.location}</div>
              {e.desc && <div className={styles.eventDesc}>{e.desc}</div>}
            </div>
          </div>
        );
      })}
      <button className={styles.viewAllBtn} onClick={onViewAll}>View All Events</button>
    </div>
  );
}

export function UniversityMembers({ members, title = 'Members', onViewAll }) {
  const { currentUser } = useAuth();
  const { data: usersData = [] } = useQuery({ queryKey: ['users'], queryFn: () => usersApi.getAll() });
  const users = React.useMemo(() => usersData.reduce((acc, u) => ({ ...acc, [u.id]: u }), {}), [usersData]);
  const navigate = useNavigate();
  if (!members || members.length === 0) return null;

  const displayMembers = members.slice(0, 5);

  return (
    <div className={styles.panelCard}>
      <h3 className={styles.panelTitle}>{title}</h3>
      {displayMembers.map((m, i) => {
        const targetUsername = m.username || m.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        const isSelf = targetUsername === currentUser?.username;
        const targetUser = Object.values(users).find(u => u.username === targetUsername);
        const canSee = targetUser ? canSeeOnlineStatus(currentUser, targetUser) : true;
        const isOnline = canSee ? (targetUser ? targetUser.isOnline : m.online) : false;
        return (
          <div key={i} className={styles.friendItem}>
            <Avatar 
              src={m.avatar} 
              name={m.name} 
              size="36px" 
              onClick={() => navigate(`/profile/${targetUsername}`, { state: { from: location.pathname } })}
            />
            <div className={styles.friendInfo} style={{ cursor: 'pointer' }} onClick={() => navigate(`/profile/${targetUsername}`, { state: { from: location.pathname } })}>
              <div className={styles.friendName}>{m.name} {m.admin && '👑'}</div>
              <div className={styles.memberBranch}>{m.branch} • {m.year}</div>
              <div className={`${styles.friendStatus}${isOnline ? ` ${styles.online}` : ''}`}>
                {isOnline ? 'Online' : 'Offline'}
              </div>
            </div>
            {!isSelf && (
              <FollowButton targetUsername={targetUsername} initialFollowing={targetUser?.isFollowing} size="sm" />
            )}
          </div>
        );
      })}
      {members.length > 5 && (
        <button className={styles.viewAllBtn} onClick={onViewAll}>View All Members</button>
      )}
    </div>
  );
}
