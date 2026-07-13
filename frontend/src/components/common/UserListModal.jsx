import { useNavigate } from 'react-router-dom';
import { useFollow } from '../../context/FollowContext';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import FollowButton from './FollowButton';
import { isImageUrl } from '../../utils/avatar';
import DefaultAvatar from './DefaultAvatar';
import styles from './UserListModal.module.css';

export default function UserListModal({ type, profileUsername, onClose }) {
  const navigate = useNavigate();
  const { following } = useFollow();
  const { username: currentUser } = useAuth();
  const { users: allUsers, getUserByUsername } = useData();
  const isFollowingTarget = following.includes(profileUsername);

  const targetUser = getUserByUsername(profileUsername);
  let usersList = [];

  if (type === 'followers') {
    const followersUsernames = targetUser?.followersList || [];
    usersList = followersUsernames.map(uName => {
      const u = getUserByUsername(uName);
      return u ? {
        name: u.displayName,
        username: u.username,
        role: u.role,
        avatar: u.avatar
      } : {
        name: uName.charAt(0).toUpperCase() + uName.slice(1),
        username: uName,
        role: 'Member',
        avatar: uName.charAt(0).toUpperCase()
      };
    });

    if (usersList.length === 0) {
      const otherUsers = Object.values(allUsers).filter(u => u.username !== profileUsername);
      usersList = otherUsers.slice(0, 4).map(u => ({
        name: u.displayName,
        username: u.username,
        role: u.role,
        avatar: u.avatar
      }));
      if (profileUsername !== currentUser && isFollowingTarget) {
        const meUser = getUserByUsername(currentUser);
        if (meUser && !usersList.some(u => u.username === currentUser)) {
          usersList.unshift({
            name: meUser.displayName,
            username: meUser.username,
            role: meUser.role || 'You',
            avatar: meUser.avatar
          });
        }
      }
    }
  } else {
    // following
    const followingUsernames = targetUser?.followingList || [];
    usersList = followingUsernames.map(uName => {
      const u = getUserByUsername(uName);
      return u ? {
        name: u.displayName,
        username: u.username,
        role: u.role,
        avatar: u.avatar
      } : {
        name: uName.charAt(0).toUpperCase() + uName.slice(1),
        username: uName,
        role: 'Member',
        avatar: uName.charAt(0).toUpperCase()
      };
    });

    if (usersList.length === 0) {
      if (profileUsername === currentUser) {
        usersList = following.map(uName => {
          const u = getUserByUsername(uName);
          return u ? {
            name: u.displayName,
            username: u.username,
            role: u.role,
            avatar: u.avatar
          } : {
            name: uName.charAt(0).toUpperCase() + uName.slice(1),
            username: uName,
            role: 'Member',
            avatar: uName.charAt(0).toUpperCase()
          };
        });
      } else {
        const otherUsers = Object.values(allUsers).filter(u => u.username !== profileUsername);
        usersList = otherUsers.slice(2, 5).map(u => ({
          name: u.displayName,
          username: u.username,
          role: u.role,
          avatar: u.avatar
        }));
      }
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h3 className={styles.title}>{type}</h3>
          <button onClick={onClose} className={styles.closeBtn}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className={styles.body}>
          {usersList.length === 0 ? (
            <div className={styles.empty}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{color: 'var(--color-text-light)'}}>
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
              </svg>
              <p style={{ margin: '12px 0 0', fontWeight: 600, color: 'var(--color-text-main)' }}>No {type} yet.</p>
              <p style={{ margin: '4px 0 0', fontSize: '0.9rem', color: 'var(--color-text-muted)', textAlign: 'center' }}>
                {type === 'followers' ? "When someone follows this account, they'll show up here." : "When this account follows someone, they'll show up here."}
              </p>
            </div>
          ) : (
            usersList.map((user, i) => (
              <div key={i} className={styles.userItem} onClick={() => { navigate(`/profile/${user.username}`); onClose(); }}>
                <div className={styles.userAvatar}>
                  {isImageUrl(user.avatar) ? <img src={user.avatar} alt="avatar" className={styles.avatarImg} /> : <DefaultAvatar />}
                </div>
                <div className={styles.userInfo}>
                  <div className={styles.userName}>{user.name}</div>
                  <div className={styles.userUsername}>@{user.username}</div>
                </div>
                <div className={styles.followBtnWrap} onClick={(e) => e.stopPropagation()}>
                  {user.username !== currentUser && <FollowButton targetUsername={user.username} size="sm" />}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
