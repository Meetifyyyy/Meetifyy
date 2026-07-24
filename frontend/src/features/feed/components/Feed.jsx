import { useCallback, memo, useEffect, useRef } from 'react';
import useUIStore from '@stores/uiStore';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { postsApi } from '@shared/api/apiClient';
import { EmptyState, ErrorState } from '@shared/components/ui/StateViews';
import PostComposer from './composer/PostComposer';
import PostSkeleton from './skeletons/PostSkeleton';
import Post from './post/Post';
import styles from './Feed.module.css';
import { useData } from '@shared/hooks/useData';

function Feed({ onPostClick }) {
  const { communities } = useData();
  const searchQuery = useUIStore(state => state.searchQuery);
  const queryClient = useQueryClient();

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
    refetch,
  } = useInfiniteQuery({
    queryKey: ['feed', searchQuery],
    queryFn: async ({ pageParam = undefined }) => {
      const limit = 20;
      const res = await postsApi.getFeed(limit, pageParam);
      return res; // Returns { posts: [...], nextCursor: ... }
    },
    getNextPageParam: (lastPage) => lastPage?.nextCursor || undefined,
    staleTime: 30_000,
  });

  // Flatten the pages of posts into a single array
  const allPosts = data?.pages.flatMap(page => page.posts || page.items || []) ?? [];

  const loadMoreRef = useRef(null);

  useEffect(() => {
    if (!hasNextPage || isLoading || isFetchingNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          fetchNextPage();
        }
      },
      { threshold: 0.1, rootMargin: '200px' }
    );
    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current);
    }
    return () => observer.disconnect();
  }, [hasNextPage, isLoading, isFetchingNextPage, fetchNextPage]);

  const handleNewPost = useCallback(async (text, pollData, mediaData, mentions) => {
    if (pollData || text || mediaData) {
      try {
        await postsApi.createPost({ text, mediaKey: mediaData?.url, mentions, poll: pollData || undefined });
        queryClient.invalidateQueries({ queryKey: ['feed'] });
      } catch (err) {
        console.error('Failed to create post:', err);
      }
    }
  }, [queryClient]);

  // Find the community tag
  const getCommunityTag = (communityId) => {
    if (!communityId) return null;
    if (Array.isArray(communities)) {
      return communities.find(c => c.id === communityId) || null;
    }
    return communities[communityId] || null;
  };

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

      {!isLoading && isError && (
        <ErrorState onRetry={refetch} />
      )}

      {!isLoading && !isError && allPosts.length === 0 && !hasNextPage && (
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

      {!isLoading && !isError && allPosts.length > 0 && allPosts.map((p) => {
        const cTag = getCommunityTag(p.communityId);
        return (
          <Post key={p.id} postData={p} communityTag={cTag} onClick={() => onPostClick && onPostClick(p, 'feed')} />
        );
      })}

      {!isLoading && !isError && hasNextPage && (
        <div ref={loadMoreRef} style={{ padding: '1.5rem', display: 'flex', justifyContent: 'center' }}>
          <div className="spinner" style={{ width: '24px', height: '24px', borderWidth: '3px' }} />
        </div>
      )}
    </div>
  );
}

export default memo(Feed);
