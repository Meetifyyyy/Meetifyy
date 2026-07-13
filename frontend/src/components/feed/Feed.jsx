import { useCallback, memo, useState, useMemo } from 'react';
import { useData } from '../../context/DataContext';
import { useSimulatedFetch } from '../../hooks/useSimulatedFetch';
import { EmptyState, ErrorState } from '../common/StateViews';
import PostComposer from './PostComposer';
import Post from './Post';
import PostSkeleton from './PostSkeleton';
import styles from './Feed.module.css';

const PAGE_SIZE = 20;

function Feed({ onPostClick }) {
  const { posts, addPost, searchQuery, getUserById, communities, currentUser } = useData();
  const [page, setPage] = useState(1);

  const filteredPosts = useMemo(() => {
    const joinedCommunityIds = new Set(
      Object.values(communities)
        .filter(c => c.joined)
        .map(c => c.id)
    );

    let mutedCommunityIds = new Set();
    try {
      mutedCommunityIds = new Set(JSON.parse(localStorage.getItem('meetify_muted_communities') || '[]'));
    } catch (e) {
      console.error(e);
    }

    return posts.filter((p) => {
      if (p.communityId && !joinedCommunityIds.has(p.communityId)) return false;
      if (p.communityId && mutedCommunityIds.has(p.communityId)) return false;

      if (searchQuery) {
        const author = getUserById(p.authorId);
        return (
          p.text?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          author?.displayName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          author?.username?.toLowerCase().includes(searchQuery.toLowerCase())
        );
      }
      return true;
    });
  }, [posts, communities, currentUser, searchQuery, getUserById]);

  const { isLoading, data, error, retry } = useSimulatedFetch(filteredPosts, 800);

  const paginatedData = useMemo(() => (data || []).slice(0, page * PAGE_SIZE), [data, page]);
  const hasMore = data ? paginatedData.length < data.length : false;

  const handleNewPost = useCallback((text, pollData, mediaData, mentions) => {
    if (pollData || text || mediaData) {
      addPost(text, pollData, null, mediaData, mentions);
      setPage(1);
    }
  }, [addPost]);

  return (
    <div className={styles.feed}>
      <PostComposer onSubmit={handleNewPost} />
      
      {isLoading && (
        <>
          <PostSkeleton />
          <PostSkeleton />
          <PostSkeleton />
        </>
      )}

      {!isLoading && error && (
        <ErrorState onRetry={retry} />
      )}

      {!isLoading && !error && data && data.length === 0 && (
        <EmptyState 
          title="It's quiet here..."
          message="Join communities or follow people to see their updates."
          icon={
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: '1rem', opacity: 0.5 }}>
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
          }
        />
      )}

      {!isLoading && !error && paginatedData.length > 0 && paginatedData.map((p) => {
        const cTag = p.communityId ? communities[p.communityId] : null;
        return (
          <Post key={p.id} postData={p} communityTag={cTag} onClick={() => onPostClick && onPostClick(p, 'feed')} />
        );
      })}

      {!isLoading && !error && hasMore && (
        <button
          onClick={() => setPage(prev => prev + 1)}
          style={{
            display: 'block',
            width: '100%',
            padding: '0.85rem',
            background: 'var(--color-bg-white)',
            border: '1px solid var(--color-border-light)',
            borderRadius: 'var(--radius-lg)',
            color: 'var(--color-primary)',
            fontWeight: 600,
            fontSize: '0.9rem',
            cursor: 'pointer',
            marginTop: '0.5rem',
            transition: 'background 0.2s',
          }}
          onMouseOver={e => e.currentTarget.style.background = 'var(--color-bg-soft)'}
          onMouseOut={e => e.currentTarget.style.background = 'var(--color-bg-white)'}
        >
          Load more
        </button>
      )}
    </div>
  );
}

export default memo(Feed);

