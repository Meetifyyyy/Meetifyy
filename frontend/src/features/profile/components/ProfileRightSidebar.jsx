import { useState, useEffect, useMemo } from 'react';

import { useAuth } from '@shared/context/AuthContext';
import Avatar from '@shared/components/avatar/Avatar';
import FollowButton from '@shared/components/ui/FollowButton';
import { useNavigate, useLocation } from 'react-router-dom';
import CalendarIcon from '@shared/components/ui/CalendarIcon';
import s from './ProfileRightSidebar.module.css';
import { usersApi, activitiesApi } from '@shared/api/apiClient';
import { useData } from '@shared/hooks/useData';
import { useJoinCommunity } from '@features/communities/hooks/useJoinCommunity';
import { toggleRegistry } from '@shared/utils/mutationRegistry';

const isImageUrl = (str) => {
  if (!str || typeof str !== 'string') return false;
  return str.startsWith('/') || str.startsWith('http://') || str.startsWith('https://') || str.startsWith('data:');
};

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

/**
 * ProfileRightSidebar
 * When `embedded` is true the component renders its cards directly
 * (the parent <aside> in ProfilePage owns the container).
 */
export default function ProfileRightSidebar({ embedded = false }) {
  const { currentUser } = useAuth();
  
  const { users, crewActivities, communities } = useData();
  
  const { mutate: toggleJoin } = useJoinCommunity();
  
  const navigate = useNavigate();
  const location = useLocation();

  const [nowTime, setNowTime] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setNowTime(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const suggestedUsers = useMemo(() => {
    if (!users || !currentUser) return [];
    const followingSet = new Set((currentUser.followingList || []).map(u => (typeof u === 'string' ? u : u?.username)?.toLowerCase()).filter(Boolean));
    return Object.values(users)
      .filter(u => {
        if (!u || !u.username) return false;
        const cleanName = u.username.toLowerCase();
        if (cleanName === currentUser.username?.toLowerCase() || u.id === currentUser.id) return false;
        if (followingSet.has(cleanName)) return false;

        const entityKey = `follow:${cleanName}`;
        const intent = toggleRegistry.getLatestIntent(entityKey, u.isFollowing || false);
        return !intent;
      })
      .slice(0, 3);
  }, [users, currentUser]);

  const myUpcoming = useMemo(() => {
    if (!currentUser) return [];
    const now = new Date();
    return (crewActivities || [])
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

  const popularActivities = useMemo(() => {
    return (crewActivities || [])
      .sort((a, b) => (b.participants?.length || 0) - (a.participants?.length || 0))
      .slice(0, 2);
  }, [crewActivities]);

  const displayActivities = myUpcoming.length > 0 ? myUpcoming.slice(0, 2) : popularActivities;
  const activitiesTitle = myUpcoming.length > 0 ? 'My Upcoming Activities' : 'Popular Activities';

  const popularCommunities = Object.values(communities || {})
    .sort((a, b) => (b.members || 0) - (a.members || 0))
    .slice(0, 3);

  const userCommunities = users?.[currentUser?.username]?.communities || currentUser?.communities || [];
  const isCommunityJoined = (comm) => {
    return !!comm.joined || userCommunities.includes(comm.name) || userCommunities.includes(comm.id);
  };

  const cards = (
    <>
      {/* ── My Upcoming / Popular Activities ── */}
      {displayActivities.length > 0 && (
        <div className={s.panelCard}>
          <h3 className={s.panelTitle}>{activitiesTitle}</h3>
          {displayActivities.map((act, i) => (
            <div key={i} className={s.eventItem} onClick={() => navigate(`/crew/${act.id}`, { state: { activity: act, from: location.pathname } })}>
              <CalendarIcon date={act.date} dateLabel={act.dateLabel} />
              <div className={s.eventDetail}>
                <div className={s.eventName}>{act.title}</div>
                <div className={s.eventSub}>{getStartsInLabel(act, i, nowTime)}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Who to follow ── */}
      {suggestedUsers.length > 0 && (
        <div className={s.panelCard}>
          <h3 className={s.panelTitle}>Who to follow</h3>
          {suggestedUsers.map(u => (
            <div 
              key={u.id} 
              className={s.personItem}
              onClick={() => {
                navigate(`/profile/${u.username}`, { state: { from: location.pathname } });
              }}
              style={{ cursor: 'pointer' }}
            >
              <Avatar src={u.avatar} name={u.displayName || u.username} size="38px" />
              <div className={s.personInfo}>
                <div className={s.personName}>{u.displayName || u.username}</div>
                <div className={s.personSub}>@{u.username}</div>
              </div>
              <FollowButton targetUsername={u.username} initialFollowing={u.isFollowing || false} size="sm" />
            </div>
          ))}
        </div>
      )}

      {/* ── Discover Communities ── */}
      {popularCommunities.length > 0 && (
        <div className={s.panelCard}>
          <h3 className={s.panelTitle}>Discover Communities</h3>
          {popularCommunities.map(c => {
            const rawJoined = isCommunityJoined(c);
            const entityKey = `joinCommunity:${c.id}`;
            const isJoined = toggleRegistry.getLatestIntent(entityKey, rawJoined);
            return (
              <div 
                key={c.id} 
                className={s.communityItem}
                onClick={() => navigate(`/communities/${c.id}`, { state: { from: location.pathname } })}
                style={{ cursor: 'pointer' }}
              >
                <div
                  className="ui-avatar"
                  style={{
                    width: '38px',
                    height: '38px',
                    flexShrink: 0,
                    ...(!isImageUrl(c.avatar) ? (c.color ? { background: c.color } : { background: 'linear-gradient(135deg, #2563EB, #7C3AED)' }) : { background: 'var(--color-bg-white)' })
                  }}
                >
                  {isImageUrl(c.avatar)
                    ? <img src={c.avatar} alt={c.name} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }}  onError={(e) => { e.target.onerror = null; e.target.src = '/default_avatar.webp'; }} />
                    : <span style={{ color: '#FFF', fontWeight: 700, fontSize: '1.2rem' }}>{c.name.charAt(0).toUpperCase()}</span>
                  }
                </div>
                <div className={s.personInfo}>
                  <div className={s.personName}>{c.name}</div>
                  <div className={s.personSub}>{c.members || 0} members</div>
                </div>
                <button
                  className={`${s.joinBtn} ${isJoined ? s.joinedBtn : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    const nextJoined = toggleRegistry.getNextToggleIntent(entityKey, rawJoined);
                    toggleJoin({ communityId: c.id, isJoined: nextJoined, currentUser });
                  }}
                >
                  {isJoined ? 'Joined' : 'Join'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </>
  );

  /* When embedded, the parent <aside> owns the container */
  if (embedded) return cards;

  return <aside style={{ display: 'contents' }}>{cards}</aside>;
}
