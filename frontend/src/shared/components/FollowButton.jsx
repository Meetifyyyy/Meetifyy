import { useState } from 'react';
import { useFollow } from '@shared/context/FollowContext';
import { useAuth } from '@shared/context/AuthContext';
import styles from './FollowButton.module.css';

export default function FollowButton({ targetUsername, size = 'md', className }) {
  const { following, toggleFollow } = useFollow();
  const { username } = useAuth();
  const [loading, setLoading] = useState(false);

  if (!targetUsername || targetUsername === username) {
    return null; // Don't show follow button for yourself
  }

  const isFollowing = following.includes(targetUsername);

  const handleClick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    toggleFollow(targetUsername);
    // Since toggleFollow is synchronous in our mock, we reset loading immediately
    setLoading(false);
  };

  const sizeClass = size === 'sm' ? styles.sizeSm : styles.sizeMd;
  const stateClass = isFollowing ? styles.following : styles.notFollowing;

  return (
    <button 
      onClick={handleClick} 
      disabled={loading}
      className={className || `${styles.followBtn} ${sizeClass} ${stateClass}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', justifyContent: 'center' }}
    >
      {loading ? (
        <div className="spinner" style={{ width: size === 'sm' ? '12px' : '14px', height: size === 'sm' ? '12px' : '14px', borderWidth: '2px', borderColor: isFollowing ? 'currentColor' : 'white', borderTopColor: 'transparent' }} />
      ) : null}
      {isFollowing ? 'Following' : 'Follow'}
    </button>
  );
}
