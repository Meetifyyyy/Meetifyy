import { useCallback, memo, useEffect, useRef } from 'react';
import useUIStore from '@stores/uiStore';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { postsApi } from '@shared/api/apiClient';
import { EmptyState, ErrorState } from '@shared/components/ui/StateViews';
import VirtualFeedList from './VirtualFeedList';
import PostComposer from './composer/PostComposer';
import PostSkeleton from './skeletons/PostSkeleton';
import PullToRefresh from './PullToRefresh';
import styles from './Feed.module.css';
import { useAuth } from '@shared/context/AuthContext';

function Feed({ onPostClick }) {
  const { currentUser } = useAuth();
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
    // M-1 fix: Scope the feed cache to the current user so logging out and logging
    // in as a different user doesn't temporarily show the previous user's feed.
    queryKey: ['feed', searchQuery, currentUser?.id],
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

  // Restore scroll position when navigating back to feed
  useEffect(() => {
    const savedY = sessionStorage.getItem('meetifyy_feed_scrollY');
    if (savedY && !isLoading && allPosts.length > 0) {
      window.scrollTo(0, parseInt(savedY, 10));
    }
  }, [isLoading, allPosts.length > 0]);

  // Save scroll position on scroll
  useEffect(() => {
    let timer;
    const handleScroll = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        sessionStorage.setItem('meetifyy_feed_scrollY', String(window.scrollY));
      }, 100);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      clearTimeout(timer);
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

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

  // Pulling down resets straight to a fresh first page rather than calling the
  // infinite query's default `refetch()` — that would re-request every page
  // the user has already scrolled through. A pull-to-refresh gesture means
  // "start me over at the freshest top," so a full reset (discarding deeper
  // pages, keyset cursors included) is both the correct semantics AND avoids
  // the N-pages-at-once request burst.
  const handlePullToRefresh = useCallback(() => {
    return queryClient.resetQueries({ queryKey: ['feed', searchQuery, currentUser?.id] });
  }, [queryClient, searchQuery, currentUser?.id]);

  return (
    <PullToRefresh onRefresh={handlePullToRefresh}>
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

        {!isLoading && !isError && allPosts.length > 0 && (
          <VirtualFeedList posts={allPosts} onPostClick={onPostClick} />
        )}

        {!isLoading && !isError && hasNextPage && (
          <div ref={loadMoreRef} style={{ padding: '1.5rem', display: 'flex', justifyContent: 'center' }}>
            <div className="spinner" style={{ width: '24px', height: '24px', borderWidth: '3px' }} />
          </div>
        )}
      </div>
    </PullToRefresh>
  );
}

export default memo(Feed);
