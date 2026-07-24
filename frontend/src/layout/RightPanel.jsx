import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import { useFollow } from '@shared/context/FollowContext';
import FollowButton from '@shared/components/ui/FollowButton';
import CalendarIcon from '@shared/components/ui/CalendarIcon';
import { useNotifications } from '@shared/hooks/useNotifications';
import { timeAgo } from '@shared/utils/time';
import { showToast } from '@shared/utils/toast';
import Avatar from '@shared/components/avatar/Avatar';
import { canSeeOnlineStatus } from '@shared/utils/presence';
import styles from './RightPanel.module.css';
import { useQuery } from '@tanstack/react-query';
import { usersApi, activitiesApi } from '@shared/api/apiClient';
import { useAuth } from '@shared/context/AuthContext';
import { useData } from '@shared/hooks/useData';

export default function RightPanel({ children, className = '' }) {
  return <aside className={`${styles.rightPanel} ${className}`.trim()}>{children}</aside>;
}

export function NotificationsActivity() {
  const { notifications, isLoading } = useNotifications();
  const { data: usersData = [] } = useQuery({ queryKey: ['users'], queryFn: () => usersApi.getAll() });
  const users = React.useMemo(() => usersData.reduce((acc, u) => ({ ...acc, [u.id]: u }), {}), [usersData]);
  const navigate = useNavigate();
  const { isFollowing, toggleFollow } = useFollow();

  const displayNotifs = notifications.slice(0, 4);

  return (
    <div className={styles.panelCard}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
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
            const actorName = n.actor?.displayName || n.actor?.username || n.metadata?.actorDisplayName || n.metadata?.actorName || n.metadata?.username || 'Someone';
            const actorAvatar = n.actor?.avatar || n.metadata?.actorAvatar || '';
            const targetUsername = n.actor?.username || n.metadata?.username || '';

            const notifType = (n.type || '').toLowerCase();
            const isFollow = notifType === 'follow';
            const postMedia = n.metadata?.postMedia || n.metadata?.mediaUrl || n.metadata?.postImage || n.metadata?.thumbnailUrl || null;

            let bodyText = n.body || n.text || '';
            if (isFollow) {
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
            } else if (notifType === 'join_request') {
              bodyText = 'requested to join your activity.';
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
              const postId = n.metadata?.postId || (n.entityType === 'POST' ? n.entityId : null);
              if (isFollow && targetUsername) {
                navigate(`/profile/${targetUsername}`);
              } else if (postId) {
                navigate(`/post/${postId}`);
              } else {
                navigate('/notifications');
              }
            };

            return (
              <div 
                key={n.id} 
                className={styles.friendItem} 
                onClick={handleItemClick}
                style={{ borderBottom: 'none', alignItems: 'center', cursor: 'pointer' }}
              >
                <Avatar 
                  src={actorAvatar} 
                  name={actorName} 
                  size="36px" 
                />
                
                <div className={styles.friendInfo} style={{ paddingLeft: '0.25rem', flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.8rem', lineHeight: 1.35, color: 'var(--color-text-muted)' }}>
                    <strong style={{ color: 'var(--color-text-main)', fontWeight: 700 }}>
                      {actorName}
                    </strong>{' '}
                    {bodyText}{' '}
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-text-light)' }}>• {timeStr}</span>
                  </div>
                </div>

                <div style={{ flexShrink: 0, marginLeft: '0.5rem' }}>
                  {isFollow && targetUsername ? (
                    <div onClick={(e) => e.stopPropagation()}>
                      <FollowButton targetUsername={targetUsername} size="sm" />
                    </div>
                  ) : postMedia ? (
                    <img src={postMedia} alt="" style={{ width: '32px', height: '32px', borderRadius: '6px', objectFit: 'cover' }} />
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
  const { data: usersData = [] } = useQuery({ queryKey: ['users'], queryFn: () => usersApi.getAll() });
  const users = React.useMemo(() => usersData.reduce((acc, u) => ({ ...acc, [u.id]: u }), {}), [usersData]);
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  const friends = Object.values(users)
    .filter(u => currentUser && u.id !== currentUser.id)
    .map((u) => {
      const canSee = canSeeOnlineStatus(currentUser, u);
      const online = canSee ? !!u.isOnline : false;
      return {
        id: u.id,
        name: u.displayName,
        username: u.username,
        avatar: u.avatar,
        avatarUrl: u.avatarUrl,
        status: online ? 'Online' : 'Offline',
        online
      };
    })
    .filter(f => f.online)
    .slice(0, 6);

  if (friends.length === 0) return null;

  return (
    <div className={styles.panelCard}>
      <h3 className={styles.panelTitle} style={{ marginBottom: '1rem' }}>Online Friends</h3>
      <div className={styles.onlineFriendsContainer} style={{ gap: '0.5rem', justifyContent: 'flex-start' }}>
        {friends.map((f, i) => (
          <div 
            key={i} 
            title={f.name}
            style={{ 
              cursor: 'pointer', 
              display: 'flex', 
              flexDirection: 'column', 
              alignItems: 'center', 
              gap: '4px',
              width: '56px'
            }}
            onClick={() => f.username && navigate(`/profile/${f.username}`)}
          >
            <Avatar 
              src={f.avatarUrl || f.avatar} 
              name={f.name} 
              size="48px" 
              isOnline={f.online} 
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
        ))}
      </div>
    </div>
  );
}

function getStartsInLabel(act, index = 0, nowTime = Date.now()) {
  if (act.startsInLabel && !act.date) return act.startsInLabel;
  try {
    if (act.date) {
      const targetDate = new Date(act.date);
      if (act.time) {
        const match = act.time.match(/(\d+):(\d+)\s*(AM|PM)/i);
        if (match) {
          let h = parseInt(match[1], 10);
          const m = parseInt(match[2], 10);
          const ampm = match[3].toUpperCase();
          if (ampm === 'PM' && h < 12) h += 12;
          if (ampm === 'AM' && h === 12) h = 0;
          targetDate.setHours(h, m, 0, 0);
        }
      }
      const diffMs = targetDate.getTime() - nowTime;
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
  const { crewActivities = [], currentUser } = useData();
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
    return crewActivities
      .filter(a => a.participants?.includes(currentUser.id))
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
            <div key={activity.id} className={styles.eventItem} onClick={() => navigate(`/crew/${activity.id}`, { state: { activity } })}>
              <CalendarIcon date={activity.date} dateLabel={activity.dateLabel} />
              <div className={styles.eventDetail}>
                <div className={styles.eventName}>{activity.title}</div>
                <div className={styles.eventSub}>{getStartsInLabel(activity, i, nowTime)}</div>
              </div>
            </div>
          ))
        )}
      </div>
      {myActivities.length > 2 && (
        <button className={styles.viewAllBtn} onClick={() => navigate('/crew', { state: { selectedTab: 'My Activities' } })} style={{ marginTop: '1rem' }}>View All Activities</button>
      )}
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
  const { isFollowing, toggleFollow } = useFollow();
  const navigate = useNavigate();
  if (!members || members.length === 0) return null;

  const displayMembers = members.slice(0, 5);

  return (
    <div className={styles.panelCard}>
      <h3 className={styles.panelTitle}>{title}</h3>
      {displayMembers.map((m, i) => {
        const targetUsername = m.username || m.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        const isFollowingUser = isFollowing(targetUsername);
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
              onClick={() => navigate(`/profile/${targetUsername}`)}
            />
            <div className={styles.friendInfo} style={{ cursor: 'pointer' }} onClick={() => navigate(`/profile/${targetUsername}`)}>
              <div className={styles.friendName}>{m.name} {m.admin && '👑'}</div>
              <div className={styles.memberBranch}>{m.branch} • {m.year}</div>
              <div className={`${styles.friendStatus}${isOnline ? ` ${styles.online}` : ''}`}>
                {isOnline ? 'Online' : 'Offline'}
              </div>
            </div>
            {!isSelf && (
              <FollowButton targetUsername={targetUsername} size="sm" />
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
