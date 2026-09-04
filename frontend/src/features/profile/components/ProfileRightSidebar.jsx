import { useAuth } from '@shared/context/AuthContext';
import Avatar from '@shared/components/avatar/Avatar';
import { CollegeRepresentativeBadge } from '@shared/components/badges/CollegeRepresentativeBadge';
import FollowButton from '@shared/components/ui/FollowButton';
import { useNavigate, useLocation } from 'react-router-dom';
import s from './ProfileRightSidebar.module.css';
import { useFollowSuggestions } from '@shared/hooks/useFollowSuggestions';
import { useCommunityRecommendations } from '@shared/hooks/useCommunityRecommendations';
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

  /**
   * Suggestions come from the server, already ranked and already filtered.
   *
   * This used to be derived in the browser: `useUsersMap()` — a merge of the
   * twenty most recently created accounts, the campus list and every
   * participant of every open conversation — filtered against
   * `currentUser.followingList`. Two things were wrong with that beyond the
   * arbitrary candidate pool.
   *
   * First, none of those payloads carried follow state, so `u.isFollowing`
   * was always `undefined` and the button rendered "Follow" for accounts the
   * viewer already followed. Second — and this is the behaviour being changed
   * here — the filter also dropped anyone with a pending follow intent, so
   * following someone made them disappear from the panel mid-click.
   *
   * Now the rows are rendered exactly as the server ranked them. A followed
   * account KEEPS its place and its button flips to "Following"; the list is
   * re-ranked (and the followed account dropped) the next time it is fetched,
   * which is on a reload. Nothing is filtered here at all.
   */
  const { suggestions } = useFollowSuggestions(3);

  /**
   * Communities come from the server too, already filtered and already drawn.
   *
   * This used to slice the top three by member count out of the shared
   * `useCommunities()` list, which had three consequences: every viewer saw
   * the same three biggest communities on every visit; the panel could be
   * entirely made of communities they had already joined; and because the
   * ranking key is member count and joining increments it, the act of joining
   * could re-sort the panel and swap the card out from under the pointer.
   *
   * The endpoint excludes joined communities in SQL and samples the rest, so
   * none of the three can happen — and the ordering is fixed by the response
   * rather than recomputed on every render, which is what the frozen-selection
   * ref here used to be working around.
   */
  const { recommendations: popularCommunities } = useCommunityRecommendations(3);

  const { mutate: toggleJoin } = useJoinCommunity();

  const navigate = useNavigate();
  const location = useLocation();


  // Membership comes from the payload's own `isJoined` / `userRole`, through the
  // same helper every other community surface uses. This used to read
  // `comm.joined` — a field the API has never returned — and fall back to
  // `users[currentUser.username].communities`, but the users map is keyed by id,
  // so that lookup was always undefined too. Between them the button read "Join"
  // for every community, including ones the viewer owned.
  const cards = (
    <>
      {suggestions.length > 0 && (
        <div className={s.panelCard}>
          <h3 className={s.panelTitle}>Who to follow</h3>
          {suggestions.map(u => (
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
              {/* Passed through unchanged, NOT `|| false`: the payload's
                  `isFollowing` is read from the Follow table, and coercing a
                  missing field to `false` is exactly how an already-followed
                  account came to show a "Follow" button. */}
              <FollowButton targetUsername={u.username} initialFollowing={u.isFollowing} size="sm" />
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
