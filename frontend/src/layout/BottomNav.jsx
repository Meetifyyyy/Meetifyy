import { useEffect, useLayoutEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useSmartNavigation } from '@shared/hooks/useSmartNavigation';
import { useAuth } from '@shared/context/AuthContext';
import Avatar from '@shared/components/avatar/Avatar';
import NavIcon from './NavIcon';
import { tabPrefetch } from './tabPrefetch';
import { CampusOutline, CampusSolid } from './CampusIcon';
import { CrewOutline, CrewSolid } from './CrewIcon';
import { MessagesOutline, MessagesSolid } from './MessageIcon';
import styles from './BottomNav.module.css';
import {
  HomeIcon as HomeOutline,
  UserIcon as ProfileOutline,
} from '@heroicons/react/24/outline';
import {
  HomeIcon as HomeSolid,
  UserIcon as ProfileSolid,
} from '@heroicons/react/24/solid';

import { useUnreadCounts } from '@features/messages/hooks/useUnreadCounts';

/*
 * Line weight per icon, in each glyph's own 24-unit viewBox.
 *
 * The icons are drawn at different sizes so they look the same size (see
 * BottomNav.module.css), and a stroke scales with its icon, so one shared
 * value would come out thicker on the enlarged icons and thinner on the shrunk
 * one. Each value is the one that lands on the same on-screen line as Home's
 * 1.75 at its size; Crew's glyph also defaults to a thinner 1.5, which is why
 * it used to read as the lightest of the five. Checked on the phone, by eye.
 */
const NAV_STROKE = {
  home: 1.75, // 26px
  campus: 1.585, // 28.7px
  messages: 1.82, // 25px
  crew: 1.72, // 26.5px
};

/** Which of the five tabs a path belongs to, or -1 for none. */
function tabIndexFor(pathname) {
  if (pathname === '/home') return 0;
  if (pathname.startsWith('/campus')) return 1;
  if (pathname.startsWith('/messages')) return 2;
  if (pathname.startsWith('/crew')) return 3;
  if (pathname.startsWith('/profile')) return 4;
  return -1;
}

export default function BottomNav({ hidden }) {
  const { smartNavigate: navigate } = useSmartNavigation();
  const location = useLocation();
  const { total: unreadMessagesCount } = useUnreadCounts();

  /**
   * A new page starts with the bar already where it belongs.
   *
   * The bar slides (0.26s) when it hides on scroll, and the same transition
   * used to run when a navigation changed whether it is shown — so arriving on
   * a page from one that hides it, Settings or Saved, showed the page with no
   * bar and then slid it up over the next quarter of a second. Scrolling is
   * the only thing that should animate it. This flag turns the transition off
   * for the frames around a route change (see BottomNav.module.css); a layout
   * effect, so it is in place before the new page's first paint.
   */
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-nav-instant', '');
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => root.removeAttribute('data-nav-instant'));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
      root.removeAttribute('data-nav-instant');
    };
  }, [location.pathname]);

  // The tabs not yet visited are fetched while the browser is idle, so a tap on
  // one finds its code already there (see tabPrefetch).
  useEffect(() => tabPrefetch.warmAllWhenIdle(), []);

  const { currentUser } = useAuth();
  const username = currentUser?.username || '';

  const routeIndex = tabIndexFor(location.pathname);

  /*
   * The tab the user just tapped, shown as active before the route arrives.
   *
   * The route can take a while to change after a tap: switching to a tab
   * already in the history is a history jump (popstate lands a frame or more
   * later), a lazy page may still be loading, and a jump that misses is
   * corrected by a second navigation. Driving the highlight from the pathname
   * alone made it wait through all of that, and in the corrected case flash on
   * the wrong tab first. The tapped tab holds the highlight until the route
   * reaches it (or a short timeout, so a navigation that was refused cannot
   * leave it stuck).
   */
  const [pendingIndex, setPendingIndex] = useState(null);
  useLayoutEffect(() => {
    if (pendingIndex === null) return undefined;
    if (routeIndex === pendingIndex) {
      setPendingIndex(null);
      return undefined;
    }
    const timer = setTimeout(() => setPendingIndex(null), 1500);
    return () => clearTimeout(timer);
  }, [pendingIndex, routeIndex]);

  const shownIndex = pendingIndex ?? routeIndex;

  const handleTabClick = (index, path) => {
    if (index !== routeIndex) setPendingIndex(index);
    navigate(path);
  };

  const isHomeActive = shownIndex === 0;
  const isCampusActive = shownIndex === 1;
  const isMessagesActive = shownIndex === 2;
  const isCrewActive = shownIndex === 3;
  const isProfileActive = shownIndex === 4;

  // Note: an open chat thread completely hides the nav on mobile to allow edge-to-edge chat.
  // The post view used to be hidden the same way, but unlike a chat it is an
  // ordinary scrolling page with no composer pinned to the bottom edge, and it
  // hides the global header too -- so dropping the nav left the in-page back
  // arrow as the only way out of it.
  const isMessageChatOpen = location.pathname.startsWith('/messages/') && location.pathname.length > '/messages/'.length;
  const isInboxChatOpen = location.pathname.startsWith('/inbox/') && location.pathname.length > '/inbox/'.length;
  const isChatOpen = isMessageChatOpen || isInboxChatOpen;
  const isHidden = hidden || isChatOpen;

  /*
   * Whether the bar is on screen, for whatever sits above it (toasts, see
   * `.custom-toast` in global.css). Absent when the bar is hidden on this page
   * or not mounted at all (pages outside the dashboard, ones that remove it),
   * so a toast then sits near the bottom edge instead of over an empty gap.
   * Scrolling it away is a separate flag (`data-chrome-hidden`). A layout
   * effect, so the flag is right before the page's first paint.
   */
  useLayoutEffect(() => {
    if (isHidden) return undefined;
    const root = document.documentElement;
    root.setAttribute('data-bottom-nav-shown', '');
    return () => root.removeAttribute('data-bottom-nav-shown');
  }, [isHidden]);

  return (
    // `data-bars-ignore`: this bar paints its own strip under the phone's
    // navigation bar, so it is not what that bar has to continue. When it
    // slides away, the page behind it is. See mobile/pageEdgeColors.js.
    <div data-bars-ignore className={`app-bottom-nav ${styles.bottomNav} ${isHidden ? styles.hiddenNav : ''}`}>
      <button 
        className={`${styles.bottomNavItem}${isHomeActive ? ` ${styles.active}` : ''}`}
        onClick={() => handleTabClick(0, '/home')}
        {...tabPrefetch.handlersFor('home')}
      >
        <div className={styles.iconWrapper}>
          <NavIcon
            className={styles.navIcon}
            active={isHomeActive}
            outline={<HomeOutline strokeWidth={NAV_STROKE.home} />}
            solid={<HomeSolid />}
          />
        </div>
        <span>Home</span>
      </button>

      <button 
        className={`${styles.bottomNavItem}${isCampusActive ? ` ${styles.active}` : ''}`}
        onClick={() => handleTabClick(1, '/campus')}
        {...tabPrefetch.handlersFor('campus')}
      >
        <div className={styles.iconWrapper}>
          <NavIcon
            className={`${styles.navIcon} ${styles.campusIcon}`}
            active={isCampusActive}
            outline={<CampusOutline size={28} strokeWidth={NAV_STROKE.campus} />}
            solid={<CampusSolid size={28} />}
          />
        </div>
        <span>Campus</span>
      </button>

      <button 
        className={`${styles.bottomNavItem}${isMessagesActive ? ` ${styles.active}` : ''}`}
        onClick={() => handleTabClick(2, '/messages')}
        {...tabPrefetch.handlersFor('messages')}
      >
        <div className={styles.iconWrapper}>
          <NavIcon
            className={`${styles.navIcon} ${styles.messagesIcon}`}
            active={isMessagesActive}
            outline={<MessagesOutline strokeWidth={NAV_STROKE.messages} />}
            solid={<MessagesSolid strokeWidth={NAV_STROKE.messages} />}
          />
          {/* A dot, not a count: the inbox shows how many. The number stays in
              the button's accessible name below. */}
          {unreadMessagesCount > 0 && <span className={styles.unreadDot} aria-hidden="true" />}
        </div>
        <span>
          {unreadMessagesCount > 0 ? `Messages, ${unreadMessagesCount} unread` : 'Messages'}
        </span>
      </button>

      <button 
        className={`${styles.bottomNavItem}${isCrewActive ? ` ${styles.active}` : ''}`}
        onClick={() => handleTabClick(3, '/crew')}
        {...tabPrefetch.handlersFor('crew')}
      >
        <div className={styles.iconWrapper}>
          <NavIcon
            className={`${styles.navIcon} ${styles.crewIcon}`}
            active={isCrewActive}
            outline={<CrewOutline size={28} strokeWidth={NAV_STROKE.crew} />}
            solid={<CrewSolid size={28} strokeWidth={NAV_STROKE.crew} />}
          />
        </div>
        <span>Crew</span>
      </button>

      <button 
        className={`${styles.bottomNavItem}${isProfileActive ? ` ${styles.active}` : ''}`}
        onClick={() => handleTabClick(4, `/profile/${username}`)}
        {...tabPrefetch.handlersFor('profile')}
      >
        <div className={styles.iconWrapper}>
          {currentUser?.avatar ? (
            <Avatar
              src={currentUser.avatar}
              name={currentUser?.displayName}
              size="28px"
              className={`${styles.bottomNavAvatar} ${isProfileActive ? styles.activeAvatarBorder : ''}`.trim()}
            />
          ) : (
            <NavIcon
              className={styles.navIcon}
              active={isProfileActive}
              outline={<ProfileOutline strokeWidth={1.75} />}
              solid={<ProfileSolid />}
            />
          )}
        </div>
        <span>Profile</span>
      </button>
    </div>
  );
}
