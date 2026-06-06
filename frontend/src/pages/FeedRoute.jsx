import { useNavigate } from 'react-router-dom';
import Feed from '../components/feed/Feed';
import RightPanel, { QuickActions, OnlineFriends, UpcomingEvents } from '../components/layout/RightPanel';

export default function FeedRoute() {
  const navigate = useNavigate();

  const handlePostClick = (post, sourceContext, communityId) => {
    // If the post has an id, navigate to /post/:id
    // Wait, the post object structure from Feed:
    const postId = post.id;
    if (postId) {
      navigate(`/post/${postId}`, { state: { post, sourceContext, communityId } });
    }
  };

  const quickActions = [
    {
      label: 'New Meeting',
      icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>,
    },
    {
      label: 'Add Friend',
      icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>,
    },
    {
      label: 'Send Message',
      icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>,
    },
  ];

  return (
    <>
      <main className="centre animate-in">
        <Feed onPostClick={handlePostClick} />
      </main>
      <RightPanel className="animate-in">
        <QuickActions actions={quickActions} />
        <OnlineFriends />
        <UpcomingEvents />
      </RightPanel>
    </>
  );
}
