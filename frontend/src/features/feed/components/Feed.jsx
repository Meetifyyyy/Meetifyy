import { useCallback, memo, useEffect, useLayoutEffect, useRef, useMemo, useState } from 'react';
import useUIStore from '@stores/uiStore';
import { focusManager, onlineManager, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { postsApi } from '@shared/api/apiClient';
import { createSubmissionKey } from '@shared/lib/idempotencyKey';
import { EmptyState, ErrorState } from '@shared/components/ui/StateViews';
import VirtualFeedList from './VirtualFeedList';
import PostComposer from './composer/PostComposer';
import HomePostSkeleton from './skeletons/HomePostSkeleton';
import PullToRefresh from '@shared/components/PullToRefresh';
import styles from './Feed.module.css';
import { useAuth } from '@shared/context/AuthContext';
import { addCreatedPostToCaches } from '../utils/postCache';
import { feedQueryOptions, refreshStaleFeedHead } from '../utils/feedQuery';
import { readSavedFeedScroll, saveFeedScroll } from '../utils/feedScrollMemory';
import VerificationGate from '@shared/components/VerificationGate/VerificationGate';
import HeaderScrollEdge from '@shared/components/ui/HeaderScrollEdge';
import HomeCommunities from '@features/communities/components/home/HomeCommunities';

function Feed({ onPostClick, onCommentClick }) {
  const { currentUser } = useAuth();
  const searchQuery = useUIStore(state => state.searchQuery);
  const queryClient = useQueryClient();
  // One idempotency key per post, kept across "tap Post again" after an error,
  // so a retry of a post whose response was lost cannot publish it twice.
  const [postKey] = useState(createSubmissionKey);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetching,
    isLoading,
    isError,
    refetch,
  } = useInfiniteQuery(feedQueryOptions(searchQuery, currentUser?.id));

  // A stale feed is refreshed by its first page, and only near the top — on
  // arriving back on Home and when the app or tab regains focus. TanStack's
  // own refetch would re-request every loaded page; see `refreshStaleFeedHead`.
  // On arrival the position about to be restored decides, not the current
  // scroll, which the route change has already reset.
  const userId = currentUser?.id;
  useEffect(() => {
    const key = feedQueryOptions(searchQuery, userId).queryKey;
    void refreshStaleFeedHead(queryClient, key, { scrollY: readSavedFeedScroll() });
    // Fire-and-forget: a failed head refresh leaves the cached list on screen.
    const unsubscribeFocus = focusManager.subscribe((focused) => {
      if (focused) void refreshStaleFeedHead(queryClient, key, { scrollY: window.scrollY });
    });
    // And on coming back online, which the feed's own refetchOnReconnect (now
    // off, for the same every-page reason) used to cover.
    const unsubscribeOnline = onlineManager.subscribe((online) => {
      if (online) void refreshStaleFeedHead(queryClient, key, { scrollY: window.scrollY });
    });
    return () => {
      unsubscribeFocus();
      unsubscribeOnline();
    };
  }, [queryClient, searchQuery, userId]);

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

  // Not while the first page is being refreshed (fetching, but not a next
  // page): fetchNextPage cancels a refetch in flight, so it would drop that
  // refresh and fetch page two from the old page one's cursor.
  const isRefreshingHead = isFetching && !isFetchingNextPage;
  useEffect(() => {
    if (!hasNextPage || isLoading || isFetchingNextPage || isRefreshingHead) return;
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
  }, [hasNextPage, isLoading, isFetchingNextPage, isRefreshingHead, fetchNextPage]);

  // Restore the scroll position when arriving back on Home.
  //
  // Once per visit, and before paint. It used to run in a passive effect keyed
  // on `[isLoading, hasPosts]`, which has two faults: it painted a frame at the
  // wrong position first (the snap on going back), and it re-ran every time
  // loading flipped. A pull-to-refresh resets the query, the skeletons show,
  // and any scrolling done meanwhile was saved; when the posts arrived this
  // effect fired again and threw the page to that stale position (the snap
  // after a refresh).
  const hasPosts = allPosts.length > 0;
  const restoredRef = useRef(false);
  useLayoutEffect(() => {
    if (restoredRef.current || isLoading || !hasPosts) return;
    restoredRef.current = true;
    const savedY = readSavedFeedScroll();
    if (savedY > 0 && Math.abs(window.scrollY - savedY) > 1) {
      window.scrollTo(0, savedY);
    }
  }, [isLoading, hasPosts]);

  // Save scroll position on scroll.
  //
  // The write is debounced, so a tap on a post within 100ms of the last scroll
  // used to lose it: the pending write was cancelled on unmount and the page
  // came back slightly short. The pending position is flushed instead. It is
  // taken from the last scroll event rather than window.scrollY at unmount,
  // which the route change may already have reset.
  useEffect(() => {
    let timer;
    let lastY = null;
    const handleScroll = () => {
      lastY = window.scrollY;
      clearTimeout(timer);
      timer = setTimeout(() => {
        saveFeedScroll(lastY);
        lastY = null;
      }, 100);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      clearTimeout(timer);
      if (lastY !== null) saveFeedScroll(lastY);
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  const handleNewPost = useCallback(async (text, pollData, mediaDataList, mentions) => {
    if (!(pollData || text || (mediaDataList && mediaDataList.length > 0))) return;

    // Pass the VERIFIED storage keys to the backend.
    const body = {
      text,
      mediaKeys: mediaDataList?.map(m => m.mediaKey).filter(Boolean),
      mentions,
      poll: pollData || undefined,
    };
    const created = await postsApi.createPost(body, { idempotencyKey: postKey.keyFor(body) });
    postKey.done();

    // Into every cached post list at once — the home feed, the author's own
    // profile, bookmarks, the community view — rather than just ['feed'].
    addCreatedPostToCaches(queryClient, created);
  }, [queryClient, postKey]);

  const handlePullToRefresh = useCallback(() => {
    return queryClient.resetQueries({ queryKey: ['feed', searchQuery, currentUser?.id] });
  }, [queryClient, searchQuery, currentUser?.id]);

  return (
    <PullToRefresh onRefresh={handlePullToRefresh}>
      {/* data-bars-ignore: the status bar continues the page behind the feed,
          never a post card. With Home's header slid away the card under the
          bar was all a sample could see, and the header then slid back in
          wearing the card's colour (and the photo's, for a frame). */}
      <div className={styles.feed} data-bars-ignore="">
        {/* `gap` matches `.feed`'s own, so this occupies no layout space. */}
        <HeaderScrollEdge gap="0.5rem" />

        <VerificationGate message="Verify your account to create posts.">
          <PostComposer onSubmit={handleNewPost} />
        </VerificationGate>

        <HomeCommunities />

        {isLoading && (
          <>
            <HomePostSkeleton media />
            <HomePostSkeleton />
            <HomePostSkeleton media />
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
          <VirtualFeedList posts={allPosts} onPostClick={onPostClick} onCommentClick={onCommentClick} />
        )}

        {!isLoading && !isError && hasNextPage && (
          <div ref={loadMoreRef} style={{ padding: '1.5rem', display: 'flex', justifyContent: 'center' }}>
            <div className="spinner" aria-label="Loading more posts" />
          </div>
        )}
      </div>
    </PullToRefresh>
  );
}

export default memo(Feed);
