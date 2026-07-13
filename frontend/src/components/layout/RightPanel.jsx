import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../../context/DataContext';
import { useFollow } from '../../context/FollowContext';
import { useNotifications } from '../../context/NotificationContext';
import { showToast } from '../../utils/toast';
import Avatar from '../common/Avatar';
import { canSeeOnlineStatus } from '../../utils/presence';
import styles from './RightPanel.module.css';

export default function RightPanel({ children, className = '' }) {
  return <aside className={`${styles.rightPanel} ${className}`.trim()}>{children}</aside>;
}

export function NotificationsActivity() {
  const { notifications, timeAgo } = useNotifications();
  const { users } = useData();
  const navigate = useNavigate();
  const { isFollowing, toggleFollow } = useFollow();

  const displayNotifs = notifications.slice(0, 4);

  return (
    <div className={styles.panelCard}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h3 className={styles.panelTitle} style={{ marginBottom: 0 }}>Recent Activity</h3>
        <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', cursor: 'pointer', fontWeight: 500 }} onClick={() => navigate('/notifications')}>See all</span>
      </div>
      
      {displayNotifs.length === 0 ? (
        <div style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', textAlign: 'center', padding: '1rem 0' }}>
          No recent activity.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {displayNotifs.map((n) => {
            const actor = Object.values(users).find(u => u.id === n.actorId) || users[n.actorId];
            const isFollow = n.type === 'follow';
            const targetUsername = actor?.username || (actor?.displayName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            const followingUser = isFollowing(targetUsername);

            // Format time ago using standard helper
            const timeStr = timeAgo(n.createdAt);

            return (
              <div key={n.id} className={styles.friendItem} style={{ borderBottom: 'none', alignItems: 'center' }}>
                <Avatar 
                  src={actor.avatarUrl || actor.avatar} 
                  name={actor?.displayName} 
                  size="36px" 
                  onClick={() => targetUsername && navigate(`/profile/${targetUsername}`)}
                />
                
                <div className={styles.friendInfo} style={{ paddingLeft: '0.25rem' }}>
                  <div style={{ fontSize: '0.8rem', lineHeight: 1.4 }}>
                    <span style={{ color: 'var(--color-text-main)', fontWeight: 700, cursor: 'pointer' }} onClick={() => targetUsername && navigate(`/profile/${targetUsername}`)}>
                      {actor?.displayName || 'Someone'}
                    </span>
                    <span style={{ color: 'var(--color-text-muted)' }}> {n.text}. {timeStr}</span>
                  </div>
                </div>

                {isFollow ? (
                  <button 
                    onClick={() => toggleFollow(targetUsername)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: followingUser ? 'var(--color-text-muted)' : 'var(--color-primary)',
                      fontWeight: 600,
                      fontSize: '0.78rem',
                      cursor: 'pointer',
                      padding: '0.25rem',
                      transition: 'opacity 0.2s'
                    }}
                  >
                    {followingUser ? 'Following' : 'Follow'}
                  </button>
                ) : (
                  <div className={styles.postPreview}>
                    {/* Placeholder image for like/comment */}
                    <img src="https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=100&q=80" alt="post" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function OnlineFriends() {
  const { users, currentUser } = useData();
  const navigate = useNavigate();

  const friends = Object.values(users)
    .filter(u => u.id !== currentUser.id)
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

export function UpcomingEvents() {
  const { crewActivities, currentUser } = useData();
  const navigate = useNavigate();

  const myActivities = useMemo(() => {
    if (!currentUser) return [];
    return crewActivities
      .filter(a => a.participants?.includes(currentUser.id))
      .sort((a, b) => new Date(a.dateLabel + ' 2024') - new Date(b.dateLabel + ' 2024'));
  }, [crewActivities, currentUser]);

  return (
    <div className={styles.panelCard}>
      <h3 className={styles.panelTitle}>My Upcoming Activities</h3>
      <div className={styles.activityList}>
        {myActivities.length === 0 ? (
          <p className={styles.emptyText}>No upcoming activities yet. Join one to get started!</p>
        ) : (
          myActivities.slice(0, 2).map(activity => (
            <div key={activity.id} className={styles.activityItem} onClick={() => navigate(`/crew/${activity.id}`, { state: { activity } })}>
              <div className={styles.activityIcon}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                  <line x1="16" y1="2" x2="16" y2="6"/>
                  <line x1="8" y1="2" x2="8" y2="6"/>
                  <line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
              </div>
              <div className={styles.activityDetails}>
                <h4>{activity.title}</h4>
                <div className={styles.activityMeta}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                    <line x1="16" y1="2" x2="16" y2="6"/>
                    <line x1="8" y1="2" x2="8" y2="6"/>
                    <line x1="3" y1="10" x2="21" y2="10"/>
                  </svg>
                  <span>{activity.dateLabel} • {activity.time}</span>
                </div>
                <div className={styles.activityMeta}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                    <circle cx="12" cy="10" r="3"/>
                  </svg>
                  <span>{Math.min(activity.slotsFilled, activity.slotsNeeded)} / {activity.slotsNeeded} joined</span>
                </div>
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
  const { currentUser, startConversation, users } = useData();
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
              <button 
                className={`${styles.actionBtn}${isFollowingUser ? ` ${styles.followingBtn}` : ''}`} 
                style={{ width: 'auto', padding: '0.3rem 0.5rem', marginBottom: 0 }}
                title={isFollowingUser ? 'Following' : 'Follow'}
                onClick={() => toggleFollow(targetUsername)}
              >
                {isFollowingUser ? 'Following' : 'Follow'}
              </button>
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
