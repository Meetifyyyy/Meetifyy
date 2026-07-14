import { useCallback, memo, useState, useMemo, useRef, useEffect } from 'react';
import { useData } from '@shared/context/DataContext';
import { useSimulatedFetch } from '@shared/hooks/useSimulatedFetch';
import { EmptyState, ErrorState } from '@shared/components/StateViews';
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

  const { isLoading, data, error, retry } = useSimulatedFetch(filteredPosts, 350);

  const paginatedData = useMemo(() => (data || []).slice(0, page * PAGE_SIZE), [data, page]);
  const hasMore = data ? paginatedData.length < data.length : false;

  const loadMoreRef = useRef(null);

  useEffect(() => {
    if (!hasMore || isLoading) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setPage(prev => prev + 1);
        }
      },
      { threshold: 0.1, rootMargin: '200px' }
    );
    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current);
    }
    return () => observer.disconnect();
  }, [hasMore, isLoading]);

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
        <div ref={loadMoreRef} style={{ padding: '1.5rem', display: 'flex', justifyContent: 'center' }}>
          <div className="spinner" style={{ width: '24px', height: '24px', borderWidth: '3px' }} />
        </div>
      )}
    </div>
  );
}

export default memo(Feed);

