import { useMemo } from 'react';

import { useAuth } from '@shared/context/AuthContext';
import Avatar from '@shared/components/avatar/Avatar';
import { CollegeRepresentativeBadge } from '@shared/components/badges/CollegeRepresentativeBadge';
import FollowButton from '@shared/components/ui/FollowButton';
import { useNavigate, useLocation } from 'react-router-dom';
import s from './ProfileRightSidebar.module.css';
import { usersApi, activitiesApi } from '@shared/api/apiClient';
import { useUsersMap } from '@shared/hooks/useUsersMap';
import { useCommunities } from '@shared/hooks/useCommunities';
import { useJoinCommunity } from '@features/communities/hooks/useJoinCommunity';
import { toggleRegistry } from '@shared/utils/mutationRegistry';
import { resolveCommunityAvatar } from '@shared/utils/avatar';
import { isCommunityMember, isCommunityOwner, communityMemberCount } from '@shared/utils/community';


/**
 * ProfileRightSidebar
 * When `embedded` is true the component renders its cards directly
 * (the parent <aside> in ProfilePage owns the container).
 */
export default function ProfileRightSidebar({ embedded = false }) {
  const { currentUser } = useAuth();
  
  const users = useUsersMap();
  const { communities } = useCommunities();
  
  const { mutate: toggleJoin } = useJoinCommunity();
  
  const navigate = useNavigate();
  const location = useLocation();


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


  // `communities` is a plain array. It used to be read with Object.values(),
  // which returned every entry twice because the hook handed back an array that
  // also carried id-keyed properties — that is what showed one community as two
  // identical cards.
  const popularCommunities = [...communities]
    // The API field is `memberCount` (the backend even sorts by it); `members`
    // does not exist on this payload, so the old read was always undefined and
    // every card fell back to "0 members".
    .sort((a, b) => communityMemberCount(b) - communityMemberCount(a))
    .slice(0, 3);

  // Membership comes from the payload's own `isJoined` / `userRole`, through the
  // same helper every other community surface uses. This used to read
  // `comm.joined` — a field the API has never returned — and fall back to
  // `users[currentUser.username].communities`, but the users map is keyed by id,
  // so that lookup was always undefined too. Between them the button read "Join"
  // for every community, including ones the viewer owned.
  const cards = (
    <>
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
                <div className={s.personName} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  {u.displayName || u.username}
                  <CollegeRepresentativeBadge isCampusRep={u.isCampusRep} user={u} size="sm" />
                </div>
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
            const rawJoined = isCommunityMember(c, currentUser);
            const entityKey = `joinCommunity:${c.id}`;
            const isJoined = toggleRegistry.getLatestIntent(entityKey, rawJoined);
            // The owner cannot leave — the server refuses it — so they get a
            // static "Owner" chip rather than a button whose only outcome is a
            // 403 and a toggle that snaps back.
            const isOwner = isCommunityOwner(c, currentUser);
            const avatarUrl = resolveCommunityAvatar(c);
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
                    ...(avatarUrl ? { background: 'var(--color-bg-white)' } : (c.color ? { background: c.color } : { background: 'linear-gradient(135deg, #2563EB, #7C3AED)' }))
                  }}
                >
                  {/* The image lives in `avatarKey` as a storage key, so it has
                      to be resolved to an absolute media URL. Reading `c.avatar`
                      raw found nothing for most communities, and for the rest
                      produced a route-relative path that 404'd into the
                      person-shaped default — which is what put a generic user
                      icon on a community. */}
                  {avatarUrl
                    ? <img src={avatarUrl} alt={c.name} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} onError={(e) => { e.target.onerror = null; e.target.style.display = 'none'; }} />
                    : <span style={{ color: '#FFF', fontWeight: 700, fontSize: '1.2rem' }}>{(c.name || '?').charAt(0).toUpperCase()}</span>
                  }
                </div>
                <div className={s.personInfo}>
                  <div className={s.personName}>{c.name}</div>
                  <div className={s.personSub}>{communityMemberCount(c)} {communityMemberCount(c) === 1 ? 'member' : 'members'}</div>
                </div>
                {isOwner ? (
                  <span className={`${s.joinBtn} ${s.joinedBtn}`} aria-label="You own this community">Owner</span>
                ) : (
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
                )}
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
