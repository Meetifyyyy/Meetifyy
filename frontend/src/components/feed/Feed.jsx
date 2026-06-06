import { useState, useEffect } from 'react';
import { useData } from '../../context/DataContext';
import PostComposer from './PostComposer';
import Post from './Post';
import PostSkeleton from './PostSkeleton';
import styles from './Feed.module.css';

export default function Feed({ onPostClick }) {
  const { posts, addPost } = useData();
  const [initialLoading, setInitialLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setInitialLoading(false);
    }, 800);
    return () => clearTimeout(timer);
  }, []);

  const handleNewPost = (text, pollData) => {
    if (pollData || text) {
      addPost(text, pollData);
    }
  };

  return (
    <div className={styles.feed}>
      <PostComposer onSubmit={handleNewPost} />
      {initialLoading ? (
        <>
          <PostSkeleton />
          <PostSkeleton />
          <PostSkeleton />
        </>
      ) : (
        posts.map((p) => (
          <Post key={p.id} postData={p} onClick={() => onPostClick && onPostClick(p, 'feed')} />
        ))
      )}
    </div>
  );
}
