import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../../context/DataContext';
import { isImageUrl } from '../../utils/avatar';
import DefaultAvatar from '../common/DefaultAvatar';
import ProfilePreviewSkeleton from '../ui/ProfilePreviewSkeleton';
import { UserX } from 'lucide-react';
import defaultCover from '../../assets/images/default_cover.png';
import styles from './SharedProfilePreview.module.css';

export function SharedProfilePreview({
  profile,
  isLoading = false,
  currentUserId
}) {
  const navigate = useNavigate();
  const { users } = useData();

  if (isLoading) {
    return <ProfilePreviewSkeleton />;
  }

  // Find live user in the context database
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

  // Resolve properties
  const displayName = liveUser?.displayName || profile.name || profile.displayName || 'Someone';
  const username = liveUser?.username || profile.username;
  const avatar = liveUser?.avatar || profile.avatar;
  const coverImage = liveUser?.cover || profile.cover || defaultCover;

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
      {/* Cover Image */}
      <div className={styles.coverWrapper}>
        <img src={coverImage} alt="" className={styles.coverPhoto} />
      </div>

      {/* Avatar Container */}
      <div className={styles.avatarContainer}>
        {isImageUrl(avatar) ? (
          <img 
            src={avatar} 
            alt={displayName} 
            className={styles.avatar} 
          />
        ) : (
          <DefaultAvatar 
            name={displayName} 
            size={80} 
            className={styles.avatar} 
          />
        )}
      </div>

      {/* Details (Name & Username centered) */}
      <div className={styles.details}>
        <span className={styles.name}>{displayName}</span>
        <span className={styles.username}>@{username}</span>
      </div>
    </div>
  );
}
