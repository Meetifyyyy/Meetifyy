import { useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Feed from '../components/Feed';
import RightPanel, { NotificationsActivity, OnlineFriends, UpcomingEvents } from '@layout/RightPanel';
import { useSystemBars } from '@shared/hooks/useSystemBars';

export default function FeedRoute() {
  const navigate = useNavigate();
  const scrollContainerRef = useRef(null);
  // In the app, the feed runs under the status and navigation bars while the
  // header and bottom navigation are slid away (no-op on the website).
  useSystemBars({ scrollThrough: true });

  const handlePostClick = useCallback((post, sourceContext, communityId, options) => {
    const postId = post?.id;
    if (postId) {
      navigate(`/post/${postId}`, {
        state: {
          post,
          sourceContext,
          communityId,
          from: '/home',
          focusComment: options?.focusComment || false,
        }
      });
    }
  }, [navigate]);

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
        <NotificationsActivity />
        <UpcomingEvents />
      </RightPanel>
    </>
  );
}
