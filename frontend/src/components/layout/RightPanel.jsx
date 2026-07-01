import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../../context/DataContext';
import { useFollow } from '../../context/FollowContext';
import { showToast } from '../../utils/toast';
import { isImageUrl } from '../../utils/avatar';
import DefaultAvatar from '../common/DefaultAvatar';
import styles from './RightPanel.module.css';

export default function RightPanel({ children, className = '' }) {
  return <aside className={`${styles.rightPanel} ${className}`.trim()}>{children}</aside>;
}

export function QuickActions({ actions }) {
  return (
    <div className={styles.panelCard}>
      <h3 className={styles.panelTitle}>Quick Actions</h3>
      {actions.map((a, i) => (
        <button key={i} className={styles.actionBtn} onClick={a.onClick}>
          {a.icon}
          {a.label}
        </button>
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────
   Find Friends — live search panel card
───────────────────────────────────────── */
export function FindFriends() {
  const { users, currentUser } = useData();
  const { isFollowing, toggleFollow } = useFollow();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  // Filter users: exclude self, match display name or username
  const q = query.trim().toLowerCase();
  const results = q.length < 1
    ? []
    : Object.values(users)
        .filter(u =>
          u.id !== currentUser?.id &&
          (
            u.displayName?.toLowerCase().includes(q) ||
            u.username?.toLowerCase().includes(q)
          )
        )
        .slice(0, 6);

  // Suggested people to follow when no query (not already followed, not self)
  const suggested = q.length < 1
    ? Object.values(users)
        .filter(u => u.id !== currentUser?.id && !isFollowing(u.username))
        .slice(0, 3)
    : [];

  const displayList = q.length >= 1 ? results : suggested;

  return (
    <div className={styles.panelCard}>
      <h3 className={styles.panelTitle}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
          <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
        Find Friends
      </h3>

      {/* Search input */}
      <div className={styles.findFriendsSearch}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={styles.findFriendsSearchIcon} aria-hidden="true">
          <circle cx="11" cy="11" r="8"/>
          <line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search by name or username…"
          className={styles.findFriendsInput}
          aria-label="Search for people"
        />
        {query && (
          <button
            className={styles.findFriendsClear}
            onClick={() => setQuery('')}
            aria-label="Clear search"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        )}
      </div>

      {/* Label above results */}
      {q.length < 1 && suggested.length > 0 && (
        <p className={styles.findFriendsLabel}>People you may know</p>
      )}
      {q.length >= 1 && results.length === 0 && (
        <p className={styles.findFriendsEmpty}>No users found for "{query}"</p>
      )}

      {/* Results list */}
      <div className={styles.findFriendsList}>
        {displayList.map(u => {
          const following = isFollowing(u.username);
          return (
            <div key={u.id} className={styles.findFriendItem}>
              <div
                className={styles.findFriendAvatar}
                onClick={() => navigate(`/profile/${u.username}`)}
                role="button"
                tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && navigate(`/profile/${u.username}`)}
                aria-label={`View ${u.displayName}'s profile`}
              >
                {isImageUrl(u.avatarUrl || u.avatar) ? (
                  <img src={u.avatarUrl || u.avatar} alt={u.displayName} className={styles.findFriendAvatarImg} />
                ) : (
                  <DefaultAvatar />
                )}
                {u.recentlyActive && <span className={styles.onlineDot} aria-label="Online" />}
              </div>

              <div
                className={styles.findFriendInfo}
                onClick={() => navigate(`/profile/${u.username}`)}
                role="button"
                tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && navigate(`/profile/${u.username}`)}
              >
                <div className={styles.findFriendName}>{u.displayName}</div>
                <div className={styles.findFriendMeta}>@{u.username}</div>
              </div>

              <button
                className={`${styles.findFriendFollowBtn} ${following ? styles.findFriendFollowing : ''}`}
                onClick={() => toggleFollow(u.username)}
                aria-label={following ? `Unfollow ${u.displayName}` : `Follow ${u.displayName}`}
              >
                {following ? 'Following' : 'Follow'}
              </button>
            </div>
          );
        })}
      </div>

      {/* Footer: view full search */}
      <button
        className={styles.viewAllBtn}
        onClick={() => navigate(q ? `/search?q=${encodeURIComponent(query)}` : '/search')}
      >
        {q ? `See all results for "${query}" →` : 'Browse all people →'}
      </button>
    </div>
  );
}

export function OnlineFriends() {
  const { users, currentUser } = useData();

  const friends = Object.values(users)
    .filter(u => u.id !== currentUser.id)
    .slice(0, 4)
    .map((u) => ({
      id: u.id,
      name: u.displayName,
      username: u.username,
      avatar: u.avatar,
      avatarUrl: u.avatarUrl,
      status: u.recentlyActive ? 'Online' : 'Offline',
      online: !!u.recentlyActive
    }));

  return (
    <div className={styles.panelCard}>
      <h3 className={styles.panelTitle}>Online Friends</h3>
      {friends.length === 0 ? (
        <div style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', textAlign: 'center', padding: '1rem 0' }}>
          No friends online yet. <br/>
          <span style={{ color: 'var(--color-primary)', cursor: 'pointer', fontWeight: 500 }} onClick={() => window.location.href='/search'}>Find people to connect with!</span>
        </div>
      ) : (
        friends.map((f, i) => (
          <div key={i} className={styles.friendItem}>
            <div className={styles.friendAvatar}>
              {isImageUrl(f.avatarUrl || f.avatar) ? (
                <img src={f.avatarUrl || f.avatar} alt={f.name} className={styles.friendAvatarImg} />
              ) : (
                <DefaultAvatar />
              )}
            </div>
            <div className={styles.friendInfo}>
              <div className={styles.friendName}>{f.name}</div>
              <div className={`${styles.friendStatus}${f.online ? ` ${styles.online}` : ''}`}>{f.status}</div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

export function UpcomingEvents() {
  return (
    <div className={styles.panelCard}>
      <h3 className={styles.panelTitle}>Upcoming</h3>
      <div className={styles.eventItem}>
        <div className={styles.eventDate}>Today<br /><span>3PM</span></div>
        <div className={styles.eventDetail}>
          <div className={styles.eventName}>Team Standup</div>
          <div className={styles.eventMeta}>30 min</div>
        </div>
      </div>
      <div className={styles.eventItem}>
        <div className={styles.eventDate}>Fri<br /><span>11AM</span></div>
        <div className={styles.eventDetail}>
          <div className={styles.eventName}>Design Review</div>
          <div className={styles.eventMeta}>1 hr</div>
        </div>
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
  const { currentUser, startConversation } = useData();
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
        return (
          <div key={i} className={styles.friendItem}>
            <div className={styles.friendAvatar} style={{ cursor: 'pointer', background: isImageUrl(m.avatar) ? 'none' : (m.admin ? 'linear-gradient(135deg, #1D4ED8, #3B82F6)' : undefined) }} onClick={() => navigate(`/profile/${targetUsername}`)}>
              {isImageUrl(m.avatar) ? (
                <img src={m.avatar} alt={m.name} className={styles.friendAvatarImg} />
              ) : (
                <DefaultAvatar />
              )}
            </div>
            <div className={styles.friendInfo} style={{ cursor: 'pointer' }} onClick={() => navigate(`/profile/${targetUsername}`)}>
              <div className={styles.friendName}>{m.name} {m.admin && '👑'}</div>
              <div className={styles.memberBranch}>{m.branch} • {m.year}</div>
              <div className={`${styles.friendStatus}${m.online ? ` ${styles.online}` : ''}`}>
                {m.online ? 'Online' : 'Offline'}
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
