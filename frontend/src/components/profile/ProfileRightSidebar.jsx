import { useState, useEffect } from 'react';
import { useData } from '../../context/DataContext';
import { useAuth } from '../../context/AuthContext';
import Avatar from '../common/Avatar';
import FollowButton from '../common/FollowButton';
import { useNavigate } from 'react-router-dom';
import s from './ProfileRightSidebar.module.css';

const isImageUrl = (str) => {
  if (!str || typeof str !== 'string') return false;
  return str.startsWith('/') || str.startsWith('http://') || str.startsWith('https://') || str.startsWith('data:');
};

/**
 * ProfileRightSidebar
 * When `embedded` is true the component renders its cards directly
 * (the parent <aside> in ProfilePage owns the container).
 */
export default function ProfileRightSidebar({ embedded = false }) {
  const { currentUser } = useAuth();
  const { users, crewActivities, communities } = useData();
  const navigate = useNavigate();

  const [suggestedUsers, setSuggestedUsers] = useState([]);

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

  const upcomingActivities = (crewActivities || []).slice(0, 2);

  const popularCommunities = Object.values(communities || {})
    .sort((a, b) => (b.members || 0) - (a.members || 0))
    .slice(0, 3);

  const cards = (
    <>
      {/* ── Happening Now ── */}
      {upcomingActivities.length > 0 && (
        <div className={s.panelCard}>
          <h3 className={s.panelTitle}>Happening Now</h3>
          {upcomingActivities.map((act, i) => (
            <div key={i} className={s.eventItem}>
              <div className={s.eventDate}>
                <span className={s.eventMonth}>
                  {act.date
                    ? new Date(act.date).toLocaleDateString('en-US', { month: 'short' })
                    : 'TBD'}
                </span>
                <span className={s.eventDay}>
                  {act.date ? new Date(act.date).getDate() : '—'}
                </span>
              </div>
              <div className={s.eventDetail}>
                <div className={s.eventName}>{act.title}</div>
                <div className={s.eventSub}>{act.timeLabel || 'Soon'}</div>
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
          {popularCommunities.map(c => (
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
                  ...( !isImageUrl(c.avatar) ? (c.color ? { background: c.color } : { background: 'linear-gradient(135deg, #2563EB, #7C3AED)' }) : { background: 'var(--color-bg-white)' } )
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
              <button className={s.joinBtn}>Join</button>
            </div>
          ))}
        </div>
      )}
    </>
  );

  /* When embedded, the parent <aside> owns the container */
  if (embedded) return cards;

  return <aside style={{ display: 'contents' }}>{cards}</aside>;
}
