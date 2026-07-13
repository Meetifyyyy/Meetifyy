import { useRef, useState } from 'react';
import { useData } from '../../context/DataContext';
import { useFollow } from '../../context/FollowContext';
import { useAuth } from '../../context/AuthContext';
import FollowButton from '../common/FollowButton';
import { useNavigate } from 'react-router-dom';
import { showToast } from '../../utils/toast';
import Avatar from '../common/Avatar';
import { isImageUrl } from '../../utils/avatar';
import ShareProfileModal from './ShareProfileModal';
import styles from './ProfileHeader.module.css';
import { useMediaViewer } from '../../context/MediaViewerContext';

export default function ProfileHeader({ profileUsername, onViewFollowers, onViewFollowing, onBack }) {
  const { getUserByUsername, currentUser, communities, startConversation, posts } = useData();
  const { updateProfile } = useAuth();
  const { following } = useFollow();
  const navigate = useNavigate();
  const { openViewer } = useMediaViewer();
  
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  
  const avatarInputRef = useRef(null);
  const coverInputRef = useRef(null);
  
  // Fetch real mock user profile
  const targetUsername = profileUsername || currentUser.username;
  const profileUser = getUserByUsername(targetUsername) || currentUser;

  const displayName = profileUser.displayName;
  const isCurrentUser = profileUser.username === currentUser.username;
  const isFollowing = following.includes(profileUser.username);

  // Get college info (not used for flip card anymore)
  const college = profileUser.collegeId ? communities[profileUser.collegeId] : null;

  const handleImageChange = (e, type) => {
    const file = e.target.files[0];
    if (file) {
      if (!file.type.startsWith('image/')) {
        showToast('Please select an image file');
        e.target.value = '';
        return;
      }
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX_WIDTH = type === 'avatar' ? 400 : 1200;
          const MAX_HEIGHT = type === 'avatar' ? 400 : 800;
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > MAX_WIDTH) {
              height *= MAX_WIDTH / width;
              width = MAX_WIDTH;
            }
          } else {
            if (height > MAX_HEIGHT) {
              width *= MAX_HEIGHT / height;
              height = MAX_HEIGHT;
            }
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.8);

          try {
            if (type === 'avatar') {
              updateProfile({ avatar: dataUrl });
              showToast('Profile picture updated successfully!');
            } else {
              updateProfile({ coverImage: dataUrl });
              showToast('Cover image updated successfully!');
            }
          } catch (err) {
            console.error('Error saving image:', err);
            showToast('Error: Image might be too large.');
          }
          e.target.value = '';
        };
        img.src = event.target.result;
      };
      reader.readAsDataURL(file);
    }
  };

  const handleMessageClick = async () => {
    if (isCurrentUser) return; // Optional: maybe don't message self, or do
    const convId = await startConversation(profileUser);
    navigate(`/messages/${convId}`);
  };

  // Stats come directly from state
  const followersCount = profileUser.followers || 0;
  const followingCount = profileUser.following || 0;
  const postsCount = profileUser.postsThisMonth || (posts ? posts.filter(p => p.authorId === profileUser.id).length : 250);

  // We can use UI faces or just initials for the mock

    
  // Override for the specific "David Chen" mockup look if needed, but we'll stick to dynamic
  // Let's assume we want to show dynamic image if it's not a single char. 
  // In mockData, they are single chars ('A', 'M', etc), but we will style it to look like the mockup.
  
  return (
    <div className={styles.profileCard}>
      {onBack && (
        <button className={styles.profileBackBtn} onClick={onBack}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      )}

      <div className={styles.profileCover}>
        <img
          src={profileUser.coverImage || "https://images.unsplash.com/photo-1497942304796-b8bc2cc898f3?q=80&w=600&auto=format&fit=crop"}
          alt="Cover"
          className={styles.profileCoverImg}
          onClick={() => {
            const coverSrc = profileUser.coverImage || "https://images.unsplash.com/photo-1497942304796-b8bc2cc898f3?q=80&w=600&auto=format&fit=crop";
            openViewer([{ url: coverSrc, type: 'image' }], 0, { authorName: displayName, authorAvatar: profileUser.avatar, source: 'Profile cover' });
          }}
          style={{ cursor: 'zoom-in' }}
        />
        {isCurrentUser && (
          <>
            <input 
              type="file" 
              accept="image/*" 
              ref={coverInputRef} 
              style={{ display: 'none' }} 
              onChange={(e) => handleImageChange(e, 'cover')} 
            />
            <button 
              className={styles.editCoverBtn} 
              aria-label="Change cover image"
              onClick={() => coverInputRef.current?.click()}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9"></path>
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
              </svg>
            </button>
          </>
        )}
      </div>

      <div className={styles.profileAvatarContainer}>
        <Avatar
          src={profileUser.avatar}
          name={profileUser.name}
          size="130px"
          onClick={() => {
            if (!isCurrentUser && isImageUrl(profileUser.avatar)) {
              openViewer([{ url: profileUser.avatar, type: 'image' }], 0, { authorName: displayName, source: 'Profile picture' });
            }
          }}
          className={styles.profileAvatarLarge}
          style={!isCurrentUser && isImageUrl(profileUser.avatar) ? { cursor: 'zoom-in' } : {}}
        >
          {isCurrentUser && (
            <>
              <input 
                type="file" 
                accept="image/*" 
                ref={avatarInputRef} 
                style={{ display: 'none' }} 
                onChange={(e) => handleImageChange(e, 'avatar')} 
              />
              <div 
                className={styles.avatarEditOverlay} 
                aria-label="Change profile picture" 
                onClick={(e) => { e.stopPropagation(); avatarInputRef.current?.click(); }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                  <circle cx="12" cy="13" r="4"></circle>
                </svg>
              </div>
            </>
          )}
        </Avatar>
      </div>

      <div className={styles.profileInfo}>
        <h2 className={styles.profileName}>{displayName}</h2>
        <p className={styles.profileUsername}>@{profileUser.username}</p>
        
        <p className={styles.profileTagline}>
          {profileUser.bio}
        </p>
        
        <div className={styles.profileStats}>
          <div className={styles.stat} style={{ cursor: 'default' }}>
            <div className={styles.statValue}>{postsCount}</div>
            <div className={styles.statLabel}>Posts</div>
          </div>
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
            {isCurrentUser ? (
              <button className={styles.editProfileBtn} onClick={() => navigate('/settings', { state: { panel: 'account' } })}>Edit Profile</button>
            ) : (
              <FollowButton targetUsername={profileUser.username} />
            )}
          </div>
          {isCurrentUser ? (
            <>
              <button className={styles.messageBtn} aria-label="Share Profile" onClick={() => setIsShareModalOpen(true)} style={{ marginRight: '0.5rem' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="18" cy="5" r="3" />
                  <circle cx="6" cy="12" r="3" />
                  <circle cx="18" cy="19" r="3" />
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                  <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                </svg>
              </button>
              <button className={styles.messageBtn} aria-label="Settings" onClick={() => navigate('/settings')}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="3"></circle>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                </svg>
              </button>
            </>
          ) : (
            <button className={styles.messageBtn} aria-label="Message" onClick={handleMessageClick}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
            </button>
          )}
        </div>
      </div>
      <ShareProfileModal 
        isOpen={isShareModalOpen} 
        onClose={() => setIsShareModalOpen(false)} 
        profileUser={profileUser} 
      />
    </div>
  );
}
