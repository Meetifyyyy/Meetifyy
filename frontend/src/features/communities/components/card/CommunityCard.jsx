import { useState, useEffect, useCallback, memo } from 'react';
import styles from './CommunityCard.module.css';
import { resolveCommunityAvatarThumb } from '@shared/utils/avatar';
import { isCommunityMember, isCommunityOwner } from '@shared/utils/community';
import { useAuth } from '@shared/context/AuthContext';
import { useJoinCommunity } from '../../hooks/useJoinCommunity';
import { toggleRegistry } from '@shared/utils/mutationRegistry';


/**
 * `onSelect` receives the community id, so a caller can hand this one stable
 * function to every card in a grid. `onClick` is the older prop and takes no
 * argument, which forces callers into a per-card inline arrow — a fresh prop on
 * every parent render, which defeats the `memo()` below. Kept for the callers
 * that still use it; prefer `onSelect`.
 */
function CommunityCard({ comm, onClick, onSelect }) {
  // `useData` sources currentUser straight from AuthContext, so this is the same
  // value without subscribing every card in the grid to conversations, users,
  // campus users and communities.
  const { currentUser } = useAuth();
  const [imgError, setImgError] = useState(false);
  
  const isJoined = isCommunityMember(comm, currentUser);
  // The server refuses to let an owner leave, so don't offer it.
  const isOwner = isCommunityOwner(comm, currentUser);
  const entityKey = `joinCommunity:${comm.id}`;
  const displayJoined = toggleRegistry.getLatestIntent(entityKey, isJoined);

  const { mutate: toggleJoin } = useJoinCommunity();

  useEffect(() => {
    setImgError(false);
  }, [comm.avatarKey, comm.avatar]);

  // Resolved to a real media URL — a bare object key dropped into `src` would
  // resolve relative to the current route and 404. The thumbnail variant is
  // what a 56px card wants; `/api/media/<key>_thumb.webp` falls back to the
  // original server-side when an older upload has no variant.
  const avatar = resolveCommunityAvatarThumb(comm);
  const initial = comm.name ? comm.name.charAt(0).toUpperCase() : '';

  const handleJoinClick = useCallback((e) => {
    e.stopPropagation();
    const nextJoined = toggleRegistry.getNextToggleIntent(entityKey, isJoined);
    toggleJoin({ communityId: comm.id, isJoined: nextJoined, currentUser });
  }, [entityKey, isJoined, toggleJoin, comm.id, currentUser]);

  const handleImgError = useCallback(() => setImgError(true), []);

  const handleCardClick = useCallback((e) => {
    if (onSelect) onSelect(comm.id);
    else onClick?.(e);
  }, [onSelect, onClick, comm.id]);

  return (
    <div className={styles.card} onClick={handleCardClick}>
      <div className={styles.cardHeader}>
        <div className={styles.cardAvatar} style={{ background: (!avatar || imgError) ? (comm.color || 'var(--color-primary)') : 'var(--color-bg-white)' }}>
          {avatar && !imgError ? (
            <img src={avatar} alt={comm.name} width={56} height={56} loading="lazy" decoding="async" className={styles.cardAvatarImg} onError={handleImgError} />
          ) : (
            <span className={styles.cardLetter}>{initial}</span>
          )}
        </div>
        {isOwner ? (
          <span className={`${styles.joinBtn} ${styles.joined}`} aria-label="You own this community">Owner</span>
        ) : (
          <button
            className={`${styles.joinBtn} ${displayJoined ? styles.joined : ''}`}
            onClick={handleJoinClick}
            disabled={false} // allowed for rapid toggle
          >
            {displayJoined ? 'Joined' : 'Join'}
          </button>
        )}
      </div>
      <h3 className={styles.cardTitle}>{comm.name}</h3>
      <p className={styles.cardDesc}>
        {comm.description && comm.description !== comm.name
          ? comm.description
          : (comm.desc && comm.desc !== comm.name
            ? comm.desc
            : `${comm.memberCount || comm.membersCount || comm.members || 1} ${(comm.memberCount || comm.membersCount || comm.members || 1) === 1 ? 'member' : 'members'}`)}
      </p>
    </div>
  );
}

export default memo(CommunityCard);
