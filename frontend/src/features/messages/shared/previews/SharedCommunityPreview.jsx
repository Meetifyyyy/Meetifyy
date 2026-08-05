import React from 'react';
import { useNavigate } from 'react-router-dom';
import { isImageUrl } from '@shared/utils/avatar';
import { getMediaUrl } from '@shared/api/apiClient';
import styles from './SharedCommunityPreview.module.css';

function formatCount(n) {
  if (!n) return '0';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString();
}

export function SharedCommunityPreview({ community }) {
  const navigate = useNavigate();

  if (!community) return null;

  const handleClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (community?.id) {
      navigate(`/communities/${community.id}`, { state: { from: 'chat' } });
    }
  };

  const membersCount = community.membersCount ?? (Array.isArray(community.members) ? community.members.length : 0);
  const avatarSrc = community.avatar ? getMediaUrl(community.avatar) : '';

  return (
    <div className={styles.card} onClick={handleClick}>
      <div className={styles.avatarWrapper}>
        {isImageUrl(avatarSrc) ? (
          <img
            src={avatarSrc}
            alt={community.name || ''}
            className={styles.avatar}
            onError={(e) => { e.target.onerror = null; e.target.src = '/default_avatar.webp'; }}
          />
        ) : (
          <div
            className={styles.avatarFallback}
            style={{ background: community.color || 'var(--color-primary, #2563eb)' }}
          >
            {community.name?.charAt(0).toUpperCase() || 'C'}
          </div>
        )}
      </div>
      <div className={styles.details}>
        <div className={styles.name}>{community.name}</div>
        <div className={styles.membersCount}>{formatCount(membersCount)} Members</div>
      </div>
    </div>
  );
}
