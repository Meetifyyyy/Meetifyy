import { useData } from '../../context/DataContext';
import { useFollow } from '../../context/FollowContext';
import FollowButton from '../common/FollowButton';
import { useNavigate } from 'react-router-dom';
import styles from './ProfileHeader.module.css';

export default function ProfileHeader({ profileUsername, onViewFollowers, onViewFollowing, onBack }) {
  const { getUserByUsername, currentUser } = useData();
  const { following } = useFollow();
  const navigate = useNavigate();
  
  // Fetch real mock user profile
  const targetUsername = profileUsername || currentUser.username;
  const profileUser = getUserByUsername(targetUsername) || currentUser;

  const displayName = profileUser.displayName;
  const isCurrentUser = profileUser.username === currentUser.username;
  const isFollowing = following.includes(profileUser.username);

  // Mock stats - in real app would come directly from backend
  let followersCount = profileUser.followers;
  if (!isCurrentUser && isFollowing) followersCount += 1;
  const followingCount = profileUser.following;

  // We can use UI faces or just initials for the mock
  // For the mockup we will use an image if available or initials
  const avatarContent = profileUser.avatar && profileUser.avatar.length === 1 
    ? profileUser.avatar 
    : <img src={profileUser.avatar} alt="avatar" className={styles.avatarImg} />;
    
  // Override for the specific "David Chen" mockup look if needed, but we'll stick to dynamic
  // Let's assume we want to show dynamic image if it's not a single char. 
  // In mockData, they are single chars ('A', 'M', etc), but we will style it to look like the mockup.
  
  return (
    <div className={styles.profileCard}>
      <div className={styles.profileCover}>
        {onBack && (
          <button className={styles.profileBackBtn} onClick={onBack}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        )}
      </div>

      <div className={styles.profileAvatarContainer}>
        <div className={styles.profileAvatarLarge}>
          {profileUser.username === 'sammydoe' ? (
             <img src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?fit=crop&w=150&h=150" alt="avatar" />
          ) : (
             avatarContent
          )}
        </div>
      </div>

      <div className={styles.profileInfo}>
        <h1 className={styles.profileName}>{displayName}</h1>
        <p className={styles.profileUsername}>@{profileUser.username}</p>
        
        <p className={styles.profileTagline}>
          {profileUser.bio}
        </p>
        
        <div className={styles.profileStats}>
          <div className={styles.stat} onClick={onViewFollowers} style={{ cursor: 'pointer' }}>
            <div className={styles.statValue}>{followersCount}</div>
            <div className={styles.statLabel}>Followers</div>
          </div>
          <div className={styles.stat} onClick={onViewFollowing} style={{ cursor: 'pointer' }}>
            <div className={styles.statValue}>{followingCount}</div>
            <div className={styles.statLabel}>Following</div>
          </div>
        </div>

        <div className={styles.profileActions}>
          <div className={styles.followBtnWrapper}>
            <FollowButton targetUsername={profileUser.username} />
          </div>
          <button className={styles.messageBtn} aria-label="Message">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
              <polyline points="22,6 12,13 2,6" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
