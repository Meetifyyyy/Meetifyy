import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { usersApi } from '@shared/api/apiClient';
import { useAuth } from '@shared/context/AuthContext';
import FollowButton from '../ui/FollowButton';
import Avatar from '../avatar/Avatar';
import styles from './UserListModal.module.css';
import Skeleton from '../skeletons/Skeleton';

export default function UserListModal({ type, profileUsername, onClose }) {
  const navigate = useNavigate();
  const { username: currentUser } = useAuth();

  const isFollowers = type === 'followers';
  const queryKey = isFollowers ? ['followers', profileUsername] : ['following', profileUsername];
  const queryFn = () => isFollowers ? usersApi.getFollowers(profileUsername) : usersApi.getFollowing(profileUsername);

  const { data: usersList = [], isLoading, isError } = useQuery({
    queryKey,
    queryFn,
    enabled: !!profileUsername,
    staleTime: 10_000,
  });

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h3 className={styles.title} style={{ textTransform: 'capitalize' }}>{type}</h3>
          <button onClick={onClose} className={styles.closeBtn}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className={styles.body}>
          {isLoading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '12px 0' }}>
              {[1, 2, 3].map(i => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <Skeleton type="circle" width="40px" height="40px" />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <Skeleton type="text" width="40%" height="0.9rem" />
                    <Skeleton type="text" width="25%" height="0.8rem" />
                  </div>
                </div>
              ))}
            </div>
          ) : isError ? (
            <div className={styles.empty}>
              <p style={{ margin: '12px 0 0', color: 'var(--color-text-muted)' }}>Could not load list.</p>
            </div>
          ) : usersList.length === 0 ? (
            <div className={styles.empty}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-text-light)' }}>
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
              </svg>
              <p style={{ margin: '12px 0 0', fontWeight: 600, color: 'var(--color-text-main)' }}>No {type} yet.</p>
              <p style={{ margin: '4px 0 0', fontSize: '0.9rem', color: 'var(--color-text-muted)', textAlign: 'center' }}>
                {isFollowers ? "When someone follows this account, they'll show up here." : "When this account follows someone, they'll show up here."}
              </p>
            </div>
          ) : (
            usersList.map((user) => (
              <div 
                key={user.id || user.username} 
                className={styles.userItem} 
                onClick={() => { navigate(`/profile/${user.username}`); onClose(); }}
              >
                <div className={styles.userAvatar}>
                  <Avatar src={user.avatar} name={user.displayName || user.username} size="40px" />
                </div>
                <div className={styles.userInfo}>
                  <div className={styles.userName}>{user.displayName || user.username}</div>
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
