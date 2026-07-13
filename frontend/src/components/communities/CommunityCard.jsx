import { useState, useEffect } from 'react';
import { useData } from '../../context/DataContext';
import { isImageUrl } from '../../utils/avatar';
import DefaultAvatar from '../common/DefaultAvatar';
import styles from './CommunityCard.module.css';

export default function CommunityCard({ comm, onClick }) {
  const { toggleJoinCommunity, currentUser } = useData();
  const isJoined = currentUser?.communities?.includes(comm.name);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [comm.avatar]);

  return (
    <div className={styles.card} onClick={onClick}>
      <div className={styles.cardHeader}>
        <div className={styles.cardAvatar} style={{ background: (!isImageUrl(comm.avatar) || imgError) ? (comm.color || 'var(--color-primary)') : 'var(--color-bg-white)' }}>
          {isImageUrl(comm.avatar) && !imgError ? (
            <img src={comm.avatar} alt={comm.name} className={styles.cardAvatarImg} onError={() => setImgError(true)} />
          ) : (
            <span className={styles.cardLetter}>
              {comm.avatar || (comm.name ? comm.name.charAt(0).toUpperCase() : '')}
            </span>
          )}
        </div>
        <button
          className={`${styles.joinBtn} ${isJoined ? styles.joined : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            toggleJoinCommunity(comm.id);
          }}
        >
          {isJoined ? 'Joined' : 'Join'}
        </button>
      </div>
      <h3 className={styles.cardTitle}>{comm.name}</h3>
      <p className={styles.cardDesc}>{comm.desc}</p>
    </div>
  );
}
