import { useRef, useCallback, useEffect } from 'react';
import { IS_MOBILE_BUILD } from '@config';
import Feed from '../components/Feed';
import RightPanel, { NotificationsActivity, OnlineFriends, UpcomingEvents } from '@layout/RightPanel';
import TrendingHashtags from '@layout/TrendingHashtags';
import { useSystemBars } from '@shared/hooks/useSystemBars';
import { usePageTransition } from '@shared/hooks/usePageTransition';
import { CENTRE_EFFECT } from '@shared/lib/navigation/centreTransition';

export default function FeedRoute() {
  // In the app a post opens out of the middle of the screen over the feed and
  // closes back into it on Back (see shared/lib/navigation/pageTransition.js;
  // pass SLIDE_EFFECT, or nothing, for the slide); on the website this navigates.
  const { open: openPage } = usePageTransition();
  const scrollContainerRef = useRef(null);
  // In the app, the feed runs under the status and navigation bars while the
  // header and bottom navigation are slid away (no-op on the website).
  useSystemBars({ scrollThrough: true });

  // The motion waits for the post page to render before it moves, so its code
  // is loaded while the feed is idle rather than on the first tap.
  useEffect(() => {
    if (!IS_MOBILE_BUILD) return undefined;
    const warm = () => {
      import('./PostDetailRoute').catch(() => {
        // Loaded on the first open instead.
      });
    };
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(warm, { timeout: 3000 });
      return () => window.cancelIdleCallback?.(id);
    }
    const id = setTimeout(warm, 1500);
    return () => clearTimeout(id);
  }, []);

  const handlePostClick = useCallback((post, sourceContext, communityId, options) => {
    const postId = post?.id;
    if (postId) {
      openPage(`/post/${postId}`, {
        state: {
          post,
          sourceContext,
          communityId,
          from: '/home',
          focusComment: options?.focusComment || false,
        }
      }, { effect: CENTRE_EFFECT });
    }
  }, [openPage]);

  const handleCommentClick = useCallback((post, sourceContext, communityId) => {
    handlePostClick(post, sourceContext, communityId, { focusComment: true });
  }, [handlePostClick]);

  return (
    <>
      <main ref={scrollContainerRef} className="centre animate-in">
        <Feed onPostClick={handlePostClick} onCommentClick={handleCommentClick} />
      </main>
      <RightPanel className="animate-in">
        <OnlineFriends />
        <TrendingHashtags />
        <NotificationsActivity />
        <UpcomingEvents />
      </RightPanel>
    </>
  );
}
