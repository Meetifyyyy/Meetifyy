import { useState, useEffect } from 'react';
import { useData } from '../../context/DataContext';
import { useNavigate } from 'react-router-dom';
import Post from '../feed/Post';
import styles from './ProfileActivity.module.css';

export default function ProfileActivity({ profileUsername }) {
  const { getUserByUsername, getUserPosts, currentUser } = useData();
  const navigate = useNavigate();

  const targetUsername = profileUsername || currentUser.username;
  const profileUser = getUserByUsername(targetUsername) || currentUser;
  const isOwnProfile = profileUser.id === currentUser.id;

  const posts = getUserPosts(profileUser.id);

  const handlePostClick = (post) => {
    navigate(`/post/${post.id}`, { state: { post, sourceContext: 'profile' } });
  };

  return (
    <div className={styles.profileSection}>
      <h2 className={styles.sectionTitle}>Recent Activity</h2>
      {posts.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem 1rem', background: 'var(--color-bg-white)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border-light)' }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: '1rem', color: 'var(--color-text-muted)' }}>
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
          <h3 style={{ fontSize: '1.15rem', color: 'var(--color-text-main)', marginBottom: '0.5rem' }}>No posts yet</h3>
          <p style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)', marginBottom: '1.25rem' }}>
            {isOwnProfile ? "You haven't posted anything yet. Share your thoughts!" : "This user hasn't shared any activity yet."}
          </p>
          {isOwnProfile && (
            <button 
              style={{ padding: '0.5rem 1rem', background: 'var(--color-bg-main)', color: 'var(--color-text-main)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontWeight: 500 }}
              onClick={() => navigate('/home')}
            >
              Go to Feed
            </button>
          )}
        </div>
      ) : (
        <div className={styles.activityList}>
          {posts.map((p) => (
            <Post key={p.id} postData={p} onClick={() => handlePostClick(p)} />
          ))}
        </div>
      )}
    </div>
  );
}
