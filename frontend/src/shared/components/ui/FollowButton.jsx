import { useState } from 'react';
import { useFollow } from '@shared/context/FollowContext';
import { useAuth } from '@shared/context/AuthContext';
import styles from './FollowButton.module.css';

const FollowButton = ({ targetUsername, size = 'md', className, style }) => {
  const { isFollowing, toggleFollow, initialized } = useFollow();
  const { currentUser } = useAuth();
  const [loading, setLoading] = useState(false);
  const [hovered, setHovered] = useState(false);

  // Don't render for own profile
  if (!targetUsername || targetUsername === currentUser?.username) return null;

  const sizeClass = size === 'sm' ? styles.sizeSm : styles.sizeMd;

  // While the following list is loading from backend, show a neutral state
  if (!initialized) {
    return (
      <button 
        disabled 
        className={className || `${styles.followBtn} ${sizeClass} ${styles.following}`}
        style={{ ...style, opacity: 0.6 }}
      >
        ...
      </button>
    );
  }

  const following = isFollowing(targetUsername);

  const handleClick = async (e) => {
    e.stopPropagation();  // prevent triggering parent card clicks
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    await toggleFollow(targetUsername);
    setLoading(false);
  };

  const label = following
    ? 'Following'
    : 'Follow';

  const stateClass = following ? styles.following : styles.notFollowing;

  return (
    <button
      onClick={handleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      disabled={loading}
      className={className || `${styles.followBtn} ${sizeClass} ${stateClass}`.trim()}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        justifyContent: 'center',
        opacity: loading ? 0.7 : 1,
        cursor: loading ? 'not-allowed' : 'pointer',
        ...style
      }}
    >
      {label}
    </button>
  );
};

export default FollowButton;
