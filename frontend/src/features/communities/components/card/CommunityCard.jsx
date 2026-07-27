import { useState, useEffect, memo } from 'react';

import { useQueryClient } from '@tanstack/react-query';
import { isImageUrl } from '@shared/utils/avatar';
import { useData } from '@shared/hooks/useData';
import { useJoinCommunity } from '../../hooks/useJoinCommunity';
import { toggleRegistry } from '@shared/utils/mutationRegistry';


function CommunityCard({ comm, onClick }) {
  const { currentUser } = useData(); 
  const queryClient = useQueryClient();
  const [imgError, setImgError] = useState(false);
  
  // Real check: is currentUser in comm.members?
  const isJoined = comm.isMember !== undefined ? comm.isMember : (comm.members?.some(m => m.userId === currentUser?.id) || currentUser?.communities?.includes(comm.name));
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
      <p className={styles.cardDesc}>{comm.description || comm.desc}</p>
    </div>
  );
}

export default memo(CommunityCard);
