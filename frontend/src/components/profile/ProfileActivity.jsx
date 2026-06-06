import { useState } from 'react';
import { useData } from '../../context/DataContext';
import { useNavigate } from 'react-router-dom';
import Post from '../feed/Post';
import styles from './ProfileActivity.module.css';

export default function ProfileActivity({ profileUsername }) {
  const { getUserByUsername, getUserPosts, currentUser } = useData();
  const navigate = useNavigate();

  const targetUsername = profileUsername || currentUser.username;
  const profileUser = getUserByUsername(targetUsername) || currentUser;

  const posts = getUserPosts(profileUser.id);

  const handlePostClick = (post) => {
    navigate(`/post/${post.id}`, { state: { post, sourceContext: 'profile' } });
  };

  return (
    <div className={styles.profileSection}>
      <h2 className={styles.sectionTitle}>Recent Activity</h2>
      {posts.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-muted)' }}>
          No recent activity.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {posts.map((p) => (
            <Post key={p.id} postData={p} onClick={() => handlePostClick(p)} />
          ))}
        </div>
      )}
    </div>
  );
}
