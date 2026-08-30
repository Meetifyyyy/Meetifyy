import { useCallback, memo, useEffect, useRef, useMemo } from 'react';
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
import { addCreatedPostToCaches } from '../utils/postCache';
import VerificationGate from '@shared/components/VerificationGate/VerificationGate';

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
    // Scope the feed cache to the current user and search query
    queryKey: ['feed', searchQuery, currentUser?.id],
    queryFn: async ({ pageParam = undefined }) => {
      const limit = 20;
      const res = await postsApi.getFeed(limit, pageParam);
      return res; // Returns { posts: [...], nextCursor: ... }
    },
    getNextPageParam: (lastPage) => lastPage?.nextCursor || undefined,
    staleTime: 60_000,
    gcTime: 10 * 60_000,
  });

  // Flatten the pages of posts into a single deduped array with stable reference
  const allPosts = useMemo(() => {
    if (!data?.pages) return [];
    const seen = new Set();
    const result = [];
    for (const page of data.pages) {
      const list = page.posts || page.items || [];
      for (const item of list) {
        if (item?.id && !seen.has(item.id)) {
          seen.add(item.id);
          result.push(item);
        }
      }
    }
    return result;
  }, [data?.pages]);

  const loadMoreRef = useRef(null);

  useEffect(() => {
    if (!hasNextPage || isLoading || isFetchingNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          fetchNextPage();
        }
      },
      { threshold: 0.05, rootMargin: '400px' }
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

  const handleNewPost = useCallback(async (text, pollData, mediaDataList, mentions) => {
    if (!(pollData || text || (mediaDataList && mediaDataList.length > 0))) return;

    // Pass the VERIFIED storage keys to the backend.
    const created = await postsApi.createPost({
      text,
      mediaKeys: mediaDataList?.map(m => m.mediaKey).filter(Boolean),
      mentions,
      poll: pollData || undefined,
    });

    // Into every cached post list at once — the home feed, the author's own
    // profile, bookmarks, the community view — rather than just ['feed'].
    addCreatedPostToCaches(queryClient, created);
  }, [queryClient]);

  const handlePullToRefresh = useCallback(() => {
    return queryClient.resetQueries({ queryKey: ['feed', searchQuery, currentUser?.id] });
  }, [queryClient, searchQuery, currentUser?.id]);

  return (
    <PullToRefresh onRefresh={handlePullToRefresh}>
      <div className={styles.feed}>
        <VerificationGate message="Verify your account to create posts.">
          <PostComposer onSubmit={handleNewPost} />
        </VerificationGate>

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
