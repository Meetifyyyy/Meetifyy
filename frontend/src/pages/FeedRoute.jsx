import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Feed from '../components/feed/Feed';
import RightPanel, { NotificationsActivity, OnlineFriends, UpcomingEvents } from '../components/layout/RightPanel';
import InstantMatchFlow from '../components/crew/InstantMatchFlow';

export default function FeedRoute() {
  const navigate = useNavigate();
  const [isInstantMatchOpen, setIsInstantMatchOpen] = useState(false);
  const [fabHidden, setFabHidden] = useState(false);
  const scrollContainerRef = useRef(null);
  const lastScrollY = useRef(0);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    if (window.innerWidth > 768) return;

    const handleScroll = () => {
      const currentScrollY = el.scrollTop;
      if (currentScrollY > lastScrollY.current && currentScrollY > 250) {
        setFabHidden(true);
      } else if (currentScrollY < lastScrollY.current || currentScrollY < 100) {
        setFabHidden(false);
      }
      lastScrollY.current = currentScrollY;
    };

    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  const handlePostClick = (post, sourceContext, communityId) => {
    const postId = post.id;
    if (postId) {
      navigate(`/post/${postId}`, { state: { post, sourceContext, communityId } });
    }
  };

  return (
    <>
      <main ref={scrollContainerRef} className="centre animate-in">
        <Feed onPostClick={handlePostClick} />
      </main>
      <RightPanel className="animate-in">
        <OnlineFriends />
        <NotificationsActivity />
        <UpcomingEvents />
      </RightPanel>

      <button
        className={`instant-match-fab${fabHidden ? ' instant-match-fab--hidden' : ''}`}
        onClick={() => setIsInstantMatchOpen(true)}
        aria-label="Instant Matchup"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
      </button>

      <InstantMatchFlow
        isOpen={isInstantMatchOpen}
        onClose={() => setIsInstantMatchOpen(false)}
      />
    </>
  );
}
