import { useState, useEffect, useMemo } from 'react';
import { useData } from '@shared/context/DataContext';
import { useAuth } from '@shared/context/AuthContext';
import Avatar from '@shared/components/Avatar';
import FollowButton from '@shared/components/FollowButton';
import { useNavigate } from 'react-router-dom';
import CalendarIcon from '@shared/components/CalendarIcon';
import s from './ProfileRightSidebar.module.css';

const isImageUrl = (str) => {
  if (!str || typeof str !== 'string') return false;
  return str.startsWith('/') || str.startsWith('http://') || str.startsWith('https://') || str.startsWith('data:');
};

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
      }
    }
  } catch (e) {
    // fallback
  }
  // mock fallback using nowTime to make it tick down slightly
  const defaultDiff = index === 0 ? 59 * 60 * 1000 + 4 * 1000 : 4 * 60 * 60 * 1000 + 18 * 60 * 1000;
  const targetMock = nowTime + defaultDiff - (nowTime % 3600000);
  const diffMs = targetMock - nowTime;
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
  const { users, crewActivities, communities, toggleJoinCommunity } = useData();
  const navigate = useNavigate();

  const [suggestedUsers, setSuggestedUsers] = useState([]);
  const [nowTime, setNowTime] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setNowTime(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (suggestedUsers.length === 0 && users && currentUser) {
      const suggestions = Object.values(users)
        .filter(u => u.id !== currentUser.id && !currentUser.followingList?.includes(u.username))
        .slice(0, 3);
      if (suggestions.length > 0) {
        setSuggestedUsers(suggestions);
      }
    }
  }, [users, currentUser, suggestedUsers.length]);

  const myUpcoming = useMemo(() => {
    if (!currentUser) return [];
    return (crewActivities || [])
      .filter(a => a.participants?.includes(currentUser.id))
      .sort((a, b) => new Date(a.dateLabel + ' 2024') - new Date(b.dateLabel + ' 2024'));
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
            <div key={i} className={s.eventItem} onClick={() => navigate(`/crew/${act.id}`, { state: { activity: act } })}>
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
              onClick={() => navigate(`/profile/${u.username}`)}
              style={{ cursor: 'pointer' }}
            >
              <Avatar src={u.avatar} name={u.displayName || u.username} size="38px" />
              <div className={s.personInfo}>
                <div className={s.personName}>{u.displayName || u.username}</div>
                <div className={s.personSub}>@{u.username}</div>
              </div>
              <FollowButton targetUsername={u.username} size="sm" />
            </div>
          ))}
        </div>
      )}

      {/* ── Discover Communities ── */}
      {popularCommunities.length > 0 && (
        <div className={s.panelCard}>
          <h3 className={s.panelTitle}>Discover Communities</h3>
          {popularCommunities.map(c => {
            const isJoined = isCommunityJoined(c);
            return (
              <div 
                key={c.id} 
                className={s.communityItem}
                onClick={() => navigate(`/communities/${c.id}`)}
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
                    ? <img src={c.avatar} alt={c.name} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} />
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
                    toggleJoinCommunity(c.id);
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
