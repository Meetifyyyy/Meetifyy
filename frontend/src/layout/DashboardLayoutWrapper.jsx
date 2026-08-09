import { useEffect } from 'react';
import { Outlet, useNavigate, useMatches } from 'react-router-dom';
import Background from '@shared/components/ui/Background';
import Header from './Header';
import Sidebar from './Sidebar';
import DashboardLayout from './DashboardLayout';
import BottomNav from './BottomNav';
import { InstantMatchProvider } from '@features/instant-match/context/InstantMatchContext';
import InstantMatchFAB from '@features/instant-match/components/InstantMatchFAB';
import InstantMatchSheet from '@features/instant-match/components/InstantMatchSheet';
import MatchPopup from '@features/instant-match/components/match/MatchPopup';

export default function DashboardLayoutWrapper() {
  const matches = useMatches();
  const navigate = useNavigate();

  // Determine if wide layout is needed based on route handle
  const isWide = matches.some(match => match.handle?.wide);
  const noPadding = matches.some(match =>
    match.pathname.startsWith('/messages') ||
    match.pathname.startsWith('/campus') ||
    match.pathname.startsWith('/profile') ||
    match.pathname.startsWith('/post') ||
    match.pathname.startsWith('/saved') ||
    match.pathname.startsWith('/settings') ||
    /^\/communities\/.+/.test(match.pathname)
  );
  // A conversation open on mobile (/messages/:id or /inbox/:id, as opposed to
  // the bare list route) renders its own chat input pinned to the bottom of
  // the viewport. Leaving the fixed BottomNav visible there overlaps that
  // input — every chat app hides its own tab bar once a thread is open, so
  // do the same here instead of stacking two fixed bottom bars.
  const isMessageThreadOpen = matches.some(match =>
    (match.pathname.startsWith('/messages/') && match.pathname !== '/messages/') ||
    (match.pathname.startsWith('/inbox/') && match.pathname !== '/inbox/')
  );
  const hideBottomNav = matches.some(match =>
    match.pathname.startsWith('/saved') ||
    match.pathname.startsWith('/settings') ||
    match.pathname.startsWith('/communities/')
  ) || isMessageThreadOpen;

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        navigate('/search');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate]);

  const handleCommunityClick = (id) => {
    navigate(`/communities/${id}`);
  };

  return (
    <InstantMatchProvider>
      <Background />
      <Header variant="dashboard" />
      <DashboardLayout wide={isWide} noPaddingMobile={noPadding}>
        <Sidebar onCommunityClick={handleCommunityClick} />
        <Outlet />
      </DashboardLayout>
      <BottomNav hidden={hideBottomNav} />
      <InstantMatchFAB />
      <InstantMatchSheet />
      <MatchPopup />
    </InstantMatchProvider>
  );
}

