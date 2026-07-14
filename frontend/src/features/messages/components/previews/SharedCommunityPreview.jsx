import React from 'react';
import { useNavigate } from 'react-router-dom';
import { isImageUrl } from '@shared/utils/avatar';
import styles from './SharedCommunityPreview.module.css';

export function SharedCommunityPreview({ community, currentUserId }) {
  const navigate = useNavigate();

  if (!community) return null;

  return (
    <div className={styles.card} onClick={() => navigate('/communities/' + community.id)}>
      <div className={styles.left}>
        <div className={styles.header}>
          <span className={styles.badge} style={{ background: 'var(--color-primary)', color: 'white' }}>Community</span>
        </div>
        
        <div className={styles.info}>
          {isImageUrl(community.avatar) ? (
            <img src={community.avatar} alt={community.name} className={styles.avatar} style={{ borderRadius: '50%', objectFit: 'cover' }} />
          ) : (
            <div className={styles.avatar} style={{ background: community.color || 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: '1.08rem', borderRadius: '50%' }}>
              {community.name?.charAt(0).toUpperCase() || 'C'}
            </div>
          )}
          <div className={styles.details}>
            <div className={styles.name}>{community.name}</div>
          </div>
        </div>

        {community.description && (
          <p className={styles.bio}>{community.description}</p>
        )}

        <div className={styles.stats}>
          <span className={styles.stat}><strong>{community.membersCount?.toLocaleString() || 0}</strong> Members</span>
        </div>
      </div>
    </div>
  );
}
