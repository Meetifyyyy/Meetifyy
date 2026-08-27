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
import InstantMatchChat from '@features/instant-match/components/chat/InstantMatchChat';
import { useAutoHideChrome } from '@shared/hooks/useAutoHideChrome';

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
    match.pathname.startsWith('/search') ||
    /^\/communities\/.+/.test(match.pathname)
  );
  // The BottomNav stays visible with a conversation open: the messages layout
  // reserves a 60px bottom row for it (see `.centre--messages` in global.css),
  // so the chat input sits above the nav rather than under it. It is only
  // hidden while the soft keyboard is open (handled in CSS via
  // `html[data-keyboard-open]`), so the input can rise to the keyboard.
  const hideBottomNav = matches.some(match =>
    match.pathname.startsWith('/saved') ||
    match.pathname.startsWith('/settings') ||
    match.pathname.startsWith('/communities/')
  );

  // Mobile chrome gets out of the way while reading and comes straight back
  // on any upward scroll. Disabled where the page is not the scroll container
  // — Messages runs its own bounded scroller and has no page scroll to react
  // to, so the header would never come back.
  const isMessages = matches.some((m) => m.pathname.startsWith('/messages'));
  useAutoHideChrome({ enabled: !isMessages });

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

  useEffect(() => {
    document.body.setAttribute('data-disable-text-selection', 'true');
    
    const handleCopy = (e) => {
      const target = e.target;
      if (
        target.tagName === 'INPUT' || 
        target.tagName === 'TEXTAREA' || 
        target.isContentEditable
      ) {
        return;
      }
      if (target.closest && target.closest('[data-text-selectable="true"]')) {
        return;
      }
      e.preventDefault();
    };

    document.addEventListener('copy', handleCopy);

    return () => {
      document.body.removeAttribute('data-disable-text-selection');
      document.removeEventListener('copy', handleCopy);
    };
  }, []);

  const handleCommunityClick = (id) => {
    navigate(`/communities/${id}`);
  };

  return (
    <InstantMatchProvider>
      <Background />
      <Header variant="dashboard" wide={isWide} />
      <DashboardLayout wide={isWide} noPaddingMobile={noPadding}>
        <Sidebar onCommunityClick={handleCommunityClick} />
        <Outlet />
      </DashboardLayout>
      <BottomNav hidden={hideBottomNav} />
      <InstantMatchFAB />
      <InstantMatchSheet />
      <MatchPopup />
      {/* The dedicated 24h conversation. Mounted at the shell so it can cover
          the app from anywhere, and so it survives navigation underneath it —
          it is not a route, because this chat has no place in the router's
          messaging space. */}
      <InstantMatchChat />
    </InstantMatchProvider>
  );
}

