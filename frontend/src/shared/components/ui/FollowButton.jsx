import { useState } from 'react';
import { useAuth } from '@shared/context/AuthContext';
import { useFollowMutation } from '@shared/hooks/useFollowMutation';
import { toggleRegistry } from '@shared/utils/mutationRegistry';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usersApi } from '@shared/api/apiClient';
import { PROFILE_KEYS } from '@shared/hooks/useProfile';
import styles from './FollowButton.module.css';

const FollowButton = ({ targetUsername, initialFollowing, size = 'md', className, style }) => {
  const { currentUser } = useAuth();
  const queryClient = useQueryClient();
  const [hovered, setHovered] = useState(false);
  const sizeClass = size === 'sm' ? styles.sizeSm : styles.sizeMd;

  const cleanTargetUsername = targetUsername?.toLowerCase();
  const cleanCurrentUser = currentUser?.username?.toLowerCase();

  // Derive the follow state from TanStack Query directly!
  const { data: targetProfile, isLoading: isProfileLoading } = useQuery({
    queryKey: PROFILE_KEYS.byUsername(cleanTargetUsername),
    queryFn: () => usersApi.getByUsername(targetUsername),
    enabled: !!cleanTargetUsername && cleanTargetUsername !== cleanCurrentUser && cleanTargetUsername !== 'unknown',
    staleTime: 1000 * 60,
    initialData: () => {
      const cached = queryClient.getQueryData(PROFILE_KEYS.byUsername(cleanTargetUsername));
      if (cached) return cached;
      if (initialFollowing !== undefined) {
        return { isFollowing: initialFollowing };
      }
      return undefined;
    }
  });

  const following = targetProfile?.isFollowing || false;
  const entityKey = `follow:${cleanTargetUsername}`;
  const displayFollowing = toggleRegistry.getLatestIntent(entityKey, following);

  const { follow, unfollow } = useFollowMutation(targetUsername);

  // Don't render for own profile
  if (!targetUsername || cleanTargetUsername === cleanCurrentUser) return null;

  // While checking follow state from API
  if (isProfileLoading && targetProfile === undefined) {
    return (
      <button 
        disabled 
        className={className || `${styles.followBtn} ${sizeClass} ${styles.following}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: 0.6,
          ...style
        }}
      >
        <span style={{ transform: 'translateY(-1.5px)', display: 'inline-block', letterSpacing: '1px', fontWeight: 'bold' }}>···</span>
      </button>
    );
  }

  const handleClick = (e) => {
    e.stopPropagation();  // prevent triggering parent card clicks
    e.preventDefault();
    
    const nextFollowing = toggleRegistry.getNextToggleIntent(entityKey, following);
    if (nextFollowing) {
      follow();
    } else {
      unfollow();
    }
  };

  const label = displayFollowing ? 'Following' : 'Follow';
  const stateClass = displayFollowing ? styles.following : styles.notFollowing;

  return (
    <button
      onClick={handleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      disabled={false} // allowed for rapid toggle
      className={className || `${styles.followBtn} ${sizeClass} ${stateClass}`.trim()}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        justifyContent: 'center',
        opacity: 1,
        cursor: 'pointer',
        ...style
      }}
    >
      {label}
    </button>
  );
};

export default FollowButton;


