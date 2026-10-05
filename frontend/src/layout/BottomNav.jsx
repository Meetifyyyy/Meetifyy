import { useEffect, useLayoutEffect } from 'react';
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

  const handleTabClick = (path) => {
    navigate(path);
  };

  const { currentUser } = useAuth();
  const username = currentUser?.username || '';
  
  const isHomeActive = location.pathname === '/home';
  const isCampusActive = location.pathname.startsWith('/campus');
  const isMessagesActive = location.pathname.startsWith('/messages');
  const isCrewActive = location.pathname.startsWith('/crew');
  const isProfileActive = location.pathname.startsWith('/profile');

  // Note: an open chat thread completely hides the nav on mobile to allow edge-to-edge chat.
  // The post view used to be hidden the same way, but unlike a chat it is an
  // ordinary scrolling page with no composer pinned to the bottom edge, and it
  // hides the global header too -- so dropping the nav left the in-page back
  // arrow as the only way out of it.
  const isMessageChatOpen = location.pathname.startsWith('/messages/') && location.pathname.length > '/messages/'.length;
  const isInboxChatOpen = location.pathname.startsWith('/inbox/') && location.pathname.length > '/inbox/'.length;
  const isChatOpen = isMessageChatOpen || isInboxChatOpen;
  const isHidden = hidden || isChatOpen;

  return (
    // `data-bars-ignore`: this bar paints its own strip under the phone's
    // navigation bar, so it is not what that bar has to continue. When it
    // slides away, the page behind it is. See mobile/pageEdgeColors.js.
    <div data-bars-ignore className={`app-bottom-nav ${styles.bottomNav} ${isHidden ? styles.hiddenNav : ''}`}>
      <button 
        className={`${styles.bottomNavItem}${isHomeActive ? ` ${styles.active}` : ''}`}
        onClick={() => handleTabClick('/home')}
        {...tabPrefetch.handlersFor('home')}
      >
        <div className={styles.iconWrapper}>
          <NavIcon
            className={styles.navIcon}
            active={isHomeActive}
            outline={<HomeOutline strokeWidth={1.75} />}
            solid={<HomeSolid />}
          />
        </div>
        <span>Home</span>
      </button>

      <button 
        className={`${styles.bottomNavItem}${isCampusActive ? ` ${styles.active}` : ''}`}
        onClick={() => handleTabClick('/campus')}
        {...tabPrefetch.handlersFor('campus')}
      >
        <div className={styles.iconWrapper}>
          <NavIcon
            className={styles.navIcon}
            active={isCampusActive}
            outline={<CampusOutline size={26} />}
            solid={<CampusSolid size={26} />}
          />
        </div>
        <span>Campus</span>
      </button>

      <button 
        className={`${styles.bottomNavItem}${isMessagesActive ? ` ${styles.active}` : ''}`}
        onClick={() => handleTabClick('/messages')}
        {...tabPrefetch.handlersFor('messages')}
      >
        <div className={styles.iconWrapper}>
          <NavIcon
            className={styles.navIcon}
            active={isMessagesActive}
            outline={<MessagesOutline />}
            solid={<MessagesSolid />}
          />
          {unreadMessagesCount > 0 && (
            <span className={styles.unreadBadge}>
              {unreadMessagesCount > 99 ? '99+' : unreadMessagesCount}
            </span>
          )}
        </div>
        <span>Messages</span>
      </button>

      <button 
        className={`${styles.bottomNavItem}${isCrewActive ? ` ${styles.active}` : ''}`}
        onClick={() => handleTabClick('/crew')}
        {...tabPrefetch.handlersFor('crew')}
      >
        <div className={styles.iconWrapper}>
          <NavIcon
            className={styles.navIcon}
            active={isCrewActive}
            outline={<CrewOutline size={26} />}
            solid={<CrewSolid size={26} />}
          />
        </div>
        <span>Crew</span>
      </button>

      <button 
        className={`${styles.bottomNavItem}${isProfileActive ? ` ${styles.active}` : ''}`}
        onClick={() => handleTabClick(`/profile/${username}`)}
        {...tabPrefetch.handlersFor('profile')}
      >
        <div className={styles.iconWrapper}>
          {currentUser?.avatar ? (
            <Avatar
              src={currentUser.avatar}
              name={currentUser?.displayName}
              size="26px"
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
