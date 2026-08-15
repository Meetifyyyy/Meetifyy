import React from 'react';
import { UsersIcon, TrendingUp, Sparkles, UserPlus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useData } from '@shared/hooks/useData';
import { useJoinCommunity } from '@features/communities/hooks/useJoinCommunity';
import { CollegeRepresentativeBadge } from '@shared/components/badges/CollegeRepresentativeBadge';
import { toggleRegistry } from '@shared/utils/mutationRegistry';
import { isImageUrl } from '@shared/utils/avatar';
import Avatar from '@shared/components/avatar/Avatar';
import FollowButton from '@shared/components/ui/FollowButton';
import styles from './SearchSidebar.module.css';

function CommunityRow({ comm, onClick }) {
  const { currentUser } = useData();
  const { mutate: toggleJoin } = useJoinCommunity();
  const rawJoined = currentUser?.communities?.includes(comm.name);
  const entityKey = `joinCommunity:${comm.id}`;
  const isJoined = toggleRegistry.getLatestIntent(entityKey, rawJoined);

  return (
    <div className={styles.communityRow} onClick={onClick}>
      <div
        className={styles.communityRowAvatar}
        style={(!isImageUrl(comm.avatar)) ? (comm.color ? { background: comm.color } : { background: 'linear-gradient(135deg, #2563EB, #7C3AED)' }) : { background: 'var(--color-bg-white)' }}
      >
        {isImageUrl(comm.avatar)
          ? <img src={comm.avatar} alt={comm.name} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} onError={(e) => { e.target.onerror = null; e.target.src = '/default_avatar.webp'; }} />
          : <span style={{ fontWeight: 700, color: '#FFFFFF' }}>{comm.avatar || comm.name?.charAt(0).toUpperCase()}</span>
        }
      </div>
      <div className={styles.communityRowInfo}>
        <span className={styles.communityRowName}>{comm.name}</span>
        <span className={styles.communityRowMembers}>
          <UsersIcon size={12} />
          {(comm.members || 0).toLocaleString()} members
        </span>
      </div>
      <button
        className={`${styles.rowActionBtn} ${isJoined ? styles.rowActionBtnActive : styles.rowActionBtnOutline}`}
        onClick={(e) => {
          e.stopPropagation();
          const nextJoined = toggleRegistry.getNextToggleIntent(entityKey, rawJoined);
          toggleJoin({ communityId: comm.id, isJoined: nextJoined, currentUser });
        }}
      >
        {isJoined ? 'Joined' : 'Join'}
      </button>
    </div>
  );
}

export default function SearchSidebar({ popularCommunities = [] }) {
  const navigate = useNavigate();
  const { users } = useData();

  const suggestedPeople = React.useMemo(() => {
    if (!users) return [];
    return Object.values(users).slice(0, 4);
  }, [users]);

  return (
    <aside className={styles.sidebar}>
      {popularCommunities.length > 0 && (
        <div className={styles.sidebarBlock}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitleRow}>
              <TrendingUp size={18} className={styles.titleIcon} />
              <h3 className={styles.sectionTitle}>Popular Communities</h3>
            </div>
            <button className={styles.viewAllBtn} onClick={() => navigate('/communities')}>
              View all
            </button>
          </div>
          <div className={styles.rowList}>
            {popularCommunities.slice(0, 5).map(c => (
              <CommunityRow
                key={c.id}
                comm={c}
                onClick={() => navigate(`/communities/${c.id}`, { state: { from: '/search' } })}
              />
            ))}
          </div>
        </div>
      )}

      {suggestedPeople.length > 0 && (
        <div className={styles.sidebarBlock}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitleRow}>
              <UserPlus size={18} className={styles.titleIcon} />
              <h3 className={styles.sectionTitle}>Suggested People</h3>
            </div>
          </div>
          <div className={styles.rowList}>
            {suggestedPeople.map(u => (
              <div key={u.id} className={styles.personRow} onClick={() => navigate(`/profile/${u.username}`)}>
                <Avatar src={u.avatar} name={u.displayName} size="36px" disableHover />
                <div className={styles.personInfo}>
                  <span className={styles.personName} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    {u.displayName}
                    <CollegeRepresentativeBadge isCampusRep={u.isCampusRep} size="sm" />
                  </span>
                  <span className={styles.personHandle}>@{u.username}</span>
                </div>
                <FollowButton targetUsername={u.username} initialFollowing={u.isFollowing} size="sm" />
              </div>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
