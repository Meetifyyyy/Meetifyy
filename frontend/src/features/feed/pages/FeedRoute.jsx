import { useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Feed from '../components/Feed';
import RightPanel, { NotificationsActivity, OnlineFriends, UpcomingEvents } from '@layout/RightPanel';

export default function FeedRoute() {
  const navigate = useNavigate();
  const scrollContainerRef = useRef(null);

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
