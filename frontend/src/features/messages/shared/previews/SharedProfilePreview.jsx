import React from 'react';
import { useNavigate } from 'react-router-dom';
import { isImageUrl } from '@shared/utils/avatar';
import { getMediaUrl } from '@shared/api/apiClient';
import DefaultAvatar from '@shared/components/avatar/DefaultAvatar';
import ProfilePreviewSkeleton from '@shared/components/skeletons/ProfilePreviewSkeleton';
import { UserX } from '@shared/components/icons';
import styles from './SharedProfilePreview.module.css';
import { useUsersMap } from '@shared/hooks/useUsersMap';

export function SharedProfilePreview({
  profile,
  isLoading = false,
}) {
  const navigate = useNavigate();
  const users = useUsersMap();

  if (isLoading) {
    return <ProfilePreviewSkeleton />;
  }

  const liveUser = profile 
    ? Object.values(users || {}).find(u => u.id === profile.id || u.username === profile.username)
    : null;

  const isProfileUnavailable = !profile || (liveUser && liveUser.deleted);

  if (isProfileUnavailable) {
    return (
      <div className={styles.unavailable} role="alert">
        <UserX size={16} />
        <span>This profile is no longer available</span>
      </div>
    );
  }

  const displayName = liveUser?.displayName || profile.name || profile.displayName || 'Someone';
  const username = liveUser?.username || profile.username;
  const rawAvatar = liveUser?.avatar || profile.avatar;
  const avatarSrc = rawAvatar ? getMediaUrl(rawAvatar) : '';

  const handleCardClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    navigate(`/profile/${username}`, { state: { from: 'chat' } });
  };

  return (
    <div 
      className={styles.container} 
      onClick={handleCardClick}
      role="article" 
      aria-label={`Shared profile of ${displayName}`}
    >
      <div className={styles.avatarContainer}>
        {isImageUrl(avatarSrc) ? (
          <img 
            src={avatarSrc} 
            alt={displayName} 
            className={styles.avatar} 
            onError={(e) => { e.target.onerror = null; e.target.src = '/default_avatar.webp'; }} 
          />
        ) : (
          <DefaultAvatar 
            name={displayName} 
            size={46} 
            className={styles.avatar} 
          />
        )}
      </div>

      <div className={styles.details}>
        <span className={styles.name}>{displayName}</span>
        <span className={styles.username}>@{username}</span>
      </div>
    </div>
  );
}
