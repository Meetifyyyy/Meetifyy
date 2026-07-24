import { useFollow } from '@shared/context/FollowContext';
import { useAuth } from '@shared/context/AuthContext';
import styles from './FollowButton.module.css';

export default function FollowButton({ targetUsername, size = 'md', className, style }) {
  const { isFollowing, isPending, toggleFollow } = useFollow();
  const { username } = useAuth();

  if (!targetUsername || targetUsername === username) {
    return null; // Don't show follow button for yourself
  }

  const followingUser = isFollowing(targetUsername);
  const pending = isPending(targetUsername);

  const handleClick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (!pending) {
      toggleFollow(targetUsername);
    }
  };

  const sizeClass = size === 'sm' ? styles.sizeSm : styles.sizeMd;
  const stateClass = followingUser ? styles.following : styles.notFollowing;

  return (
    <button 
      onClick={handleClick} 
      disabled={pending}
      className={className || `${styles.followBtn} ${sizeClass} ${stateClass}`}
      style={{ 
        display: 'inline-flex', 
        alignItems: 'center', 
        gap: '6px', 
        justifyContent: 'center',
        opacity: pending ? 0.6 : 1,
        cursor: pending ? 'not-allowed' : 'pointer',
        ...style 
      }}
    >
      {pending ? '...' : followingUser ? 'Following' : 'Follow'}
    </button>
  );
}
