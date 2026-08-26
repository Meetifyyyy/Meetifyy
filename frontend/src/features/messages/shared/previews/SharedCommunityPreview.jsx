import React from 'react';
import { useNavigate } from 'react-router-dom';
import { isImageUrl } from '@shared/utils/avatar';
import { getMediaUrl } from '@shared/api/apiClient';
import styles from './SharedCommunityPreview.module.css';

function formatCount(n) {
  // Coerce first. Messages already sent carry payloads where membersCount was
  // mistakenly the members ARRAY, and those cannot be rewritten retroactively —
  // an array reaching toLocaleString() below is what rendered
  // "[object Object],[object Object],[object Object] Members".
  const count = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  if (!count) return '0';
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return count.toLocaleString();
}

/** Member count from whichever shape the (possibly historical) payload used. */
function resolveMemberCount(community) {
  const direct = community?.membersCount ?? community?.memberCount;
  if (typeof direct === 'number' && Number.isFinite(direct)) return direct;
  // Older shares put the array here; and the detail shape uses `members`.
  if (Array.isArray(direct)) return direct.length;
  if (Array.isArray(community?.members)) return community.members.length;
  return 0;
}

export function SharedCommunityPreview({ community, isMe = false }) {
  const navigate = useNavigate();

  if (!community) return null;

  const handleClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (community?.id) {
      navigate(`/communities/${community.id}`, { state: { from: 'chat' } });
    }
  };

  const membersCount = resolveMemberCount(community);
  const rawAvatar = community.avatarKey || community.avatar;
  const avatarSrc = rawAvatar ? getMediaUrl(rawAvatar) : '';

  return (
    <div className={`${styles.card} ${isMe ? styles.cardMe : styles.cardThem}`} onClick={handleClick}>
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
        <div className={styles.membersCount}>{formatCount(membersCount)} {membersCount === 1 ? 'Member' : 'Members'}</div>
      </div>
    </div>
  );
}
