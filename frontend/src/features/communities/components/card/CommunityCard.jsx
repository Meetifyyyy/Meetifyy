import { useState, useEffect, memo } from 'react';
import styles from './CommunityCard.module.css';
import { useQueryClient } from '@tanstack/react-query';
import { isImageUrl } from '@shared/utils/avatar';
import { useAuth } from '@shared/context/AuthContext';
import { useJoinCommunity } from '../../hooks/useJoinCommunity';
import { toggleRegistry } from '@shared/utils/mutationRegistry';


function CommunityCard({ comm, onClick }) {
  // `useData` sources currentUser straight from AuthContext, so this is the same
  // value without subscribing every card in the grid to conversations, users,
  // campus users and communities.
  const { currentUser } = useAuth();
  const queryClient = useQueryClient();
  const [imgError, setImgError] = useState(false);
  
  // Real check: is currentUser in comm.members or owner?
  const isJoined = (comm.ownerId && currentUser?.id && comm.ownerId === currentUser.id) ||
    comm.userRole === 'OWNER' ||
    comm.userRole === 'MODERATOR' ||
    comm.userRole === 'MEMBER' ||
    (comm.isJoined !== undefined ? Boolean(comm.isJoined) : (comm.isMember !== undefined ? Boolean(comm.isMember) : false)) ||
    (comm.members?.some(m => (m.userId || m.id || m.user?.id) === currentUser?.id)) ||
    currentUser?.communities?.includes(comm.name);
  const entityKey = `joinCommunity:${comm.id}`;
  const displayJoined = toggleRegistry.getLatestIntent(entityKey, isJoined);

  const { mutate: toggleJoin } = useJoinCommunity();

  useEffect(() => {
    setImgError(false);
  }, [comm.avatarKey, comm.avatar]);

  const avatar = comm.avatarKey || comm.avatar;

  return (
    <div className={styles.card} onClick={onClick}>
      <div className={styles.cardHeader}>
        <div className={styles.cardAvatar} style={{ background: (!isImageUrl(avatar) || imgError) ? (comm.color || 'var(--color-primary)') : 'var(--color-bg-white)' }}>
          {isImageUrl(avatar) && !imgError ? (
            <img src={avatar} alt={comm.name} loading="lazy" className={styles.cardAvatarImg} onError={() => setImgError(true)} />
          ) : (
            <span className={styles.cardLetter}>
              {avatar || (comm.name ? comm.name.charAt(0).toUpperCase() : '')}
            </span>
          )}
        </div>
        <button
          className={`${styles.joinBtn} ${displayJoined ? styles.joined : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            const nextJoined = toggleRegistry.getNextToggleIntent(entityKey, isJoined);
            toggleJoin({ communityId: comm.id, isJoined: nextJoined, currentUser });
          }}
          disabled={false} // allowed for rapid toggle
        >
          {displayJoined ? 'Joined' : 'Join'}
        </button>
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
