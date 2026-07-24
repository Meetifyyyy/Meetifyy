import { useState, useEffect, memo } from 'react';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { communitiesApi } from '@shared/api/apiClient';
import { isImageUrl } from '@shared/utils/avatar';
import styles from './CommunityCard.module.css';
import { useData } from '@shared/hooks/useData';


function CommunityCard({ comm, onClick }) {
  const { currentUser } = useData(); // we'll keep currentUser until Phase 1
  const queryClient = useQueryClient();
  const [imgError, setImgError] = useState(false);
  
  // Real check: is currentUser in comm.members?
  const isJoined = comm.members?.some(m => m.userId === currentUser?.id) || currentUser?.communities?.includes(comm.name);

  const joinMutation = useMutation({
    mutationFn: (id) => isJoined ? communitiesApi.leave(id) : communitiesApi.join(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['communities'] });
    },
  });

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
          className={`${styles.joinBtn} ${isJoined ? styles.joined : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            joinMutation.mutate(comm.id);
          }}
          disabled={joinMutation.isPending}
        >
          {isJoined ? 'Joined' : 'Join'}
        </button>
      </div>
      <h3 className={styles.cardTitle}>{comm.name}</h3>
      <p className={styles.cardDesc}>{comm.description || comm.desc}</p>
    </div>
  );
}

export default memo(CommunityCard);
