import { useFollow } from '../../context/FollowContext';
import { useAuth } from '../../context/AuthContext';
import styles from './FollowButton.module.css';

export default function FollowButton({ targetUsername, size = 'md', className }) {
  const { following, toggleFollow } = useFollow();
  const { username } = useAuth();

  if (!targetUsername || targetUsername === username) {
    return null; // Don't show follow button for yourself
  }

  const isFollowing = following.includes(targetUsername);

  const handleClick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    toggleFollow(targetUsername);
  };

  const sizeClass = size === 'sm' ? styles.sizeSm : styles.sizeMd;
  const stateClass = isFollowing ? styles.following : styles.notFollowing;

  return (
    <button 
      onClick={handleClick} 
      className={className || `${styles.followBtn} ${sizeClass} ${stateClass}`}
    >
      {isFollowing ? 'Following' : 'Follow'}
    </button>
  );
}
