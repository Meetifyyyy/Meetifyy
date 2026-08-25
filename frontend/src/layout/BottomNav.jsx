import { useNavigate, useLocation } from 'react-router-dom';
import { useSmartNavigation } from '@shared/hooks/useSmartNavigation';
import { useAuth } from '@shared/context/AuthContext';
import Avatar from '@shared/components/avatar/Avatar';
import NavIcon from './NavIcon';
import styles from './BottomNav.module.css';
import {
  HomeIcon as HomeOutline,
  ChatBubbleOvalLeftEllipsisIcon as MessagesOutline,
  UserIcon as ProfileOutline,
} from '@heroicons/react/24/outline';
import {
  HomeIcon as HomeSolid,
  ChatBubbleOvalLeftEllipsisIcon as MessagesSolid,
  UserIcon as ProfileSolid,
} from '@heroicons/react/24/solid';

// Campus and Crew have no Heroicons counterpart, so their two variants are
// drawn here -- the same two shapes the nav has always used, unchanged in
// geometry. Only the paint differs between them, and each now spreads props so
// <NavIcon> can hand it the layer class that cross-fades the pair.
//
// The "Solid" variants used to be `fill="none"` with a heavier stroke, which
// made Campus and Crew the only tabs that thickened instead of filling while
// every Heroicons tab switched to a genuinely solid glyph. They are filled with
// currentColor now so all five tabs read the same way when active.

const CompassOutline = (props) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <circle cx="12" cy="12" r="10" />
    <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
  </svg>
);

// The needle is knocked out in the surface colour rather than left as a hole:
// both navigations sit on --color-bg-white, and a knockout keeps the dial
// readable at 22px where a stroked needle over a filled disc would smear.
const CompassSolid = (props) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <circle cx="12" cy="12" r="10" fill="currentColor" />
    <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" fill="var(--color-bg-white)" stroke="var(--color-bg-white)" strokeWidth="1.5" />
  </svg>
);

const CampusOutline = (props) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
    <path d="M6 12v5c0 2 2 3 6 3s6-1 6-3v-5" />
  </svg>
);

const CampusSolid = (props) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
    {/* Split so the tassel (M22 10v6) stays a stroked line -- filling it would
        do nothing -- while the mortarboard closes into a solid diamond. */}
    <path d="M22 10v6" />
    <path d="M2 10l10-5 10 5-10 5z" fill="currentColor" />
    <path d="M6 12v5c0 2 2 3 6 3s6-1 6-3v-5" fill="currentColor" />
  </svg>
);

import { useUnreadCounts } from '@features/messages/hooks/useUnreadCounts';

export default function BottomNav({ hidden }) {
  const { smartNavigate: navigate } = useSmartNavigation();
  const location = useLocation();
  const { total: unreadMessagesCount } = useUnreadCounts();

  const handleTabClick = (path) => {
    navigate(path);
  };

  const { currentUser } = useAuth();
  const username = currentUser?.username || '';
  
  const isHomeActive = location.pathname === '/home';
  const isCampusActive = location.pathname.startsWith('/campus');
  const isMessagesActive = location.pathname.startsWith('/messages');
  const isNotificationsActive = location.pathname.startsWith('/notifications');
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
    <div className={`app-bottom-nav ${styles.bottomNav} ${isHidden ? styles.hiddenNav : ''}`}>
      <button 
        className={`${styles.bottomNavItem}${isHomeActive ? ` ${styles.active}` : ''}`}
        onClick={() => handleTabClick('/home')}
        onMouseEnter={() => import('@features/feed/pages/FeedRoute')}
      >
        <div className={styles.iconWrapper}>
          <NavIcon
            className={styles.navIcon}
            active={isHomeActive}
            outline={<HomeOutline />}
            solid={<HomeSolid />}
          />
        </div>
        <span>Home</span>
      </button>

      <button 
        className={`${styles.bottomNavItem}${isCampusActive ? ` ${styles.active}` : ''}`}
        onClick={() => handleTabClick('/campus')}
        onMouseEnter={() => import('@features/campus/pages/CampusPage')}
      >
        <div className={styles.iconWrapper}>
          <NavIcon
            className={styles.navIcon}
            active={isCampusActive}
            outline={<CampusOutline />}
            solid={<CampusSolid />}
          />
        </div>
        <span>Campus</span>
      </button>

      <button 
        className={`${styles.bottomNavItem}${isMessagesActive ? ` ${styles.active}` : ''}`}
        onClick={() => handleTabClick('/messages')}
        onMouseEnter={() => import('@features/messages/pages/MessagesRoute')}
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
        onMouseEnter={() => import('@features/crew/pages/FindYourCrewPage')}
      >
        <div className={styles.iconWrapper}>
          <NavIcon
            className={styles.navIcon}
            active={isCrewActive}
            outline={<CompassOutline />}
            solid={<CompassSolid />}
          />
        </div>
        <span>Crew</span>
      </button>

      <button 
        className={`${styles.bottomNavItem}${isProfileActive ? ` ${styles.active}` : ''}`}
        onClick={() => handleTabClick(`/profile/${username}`)}
        onMouseEnter={() => import('@features/profile/pages/ProfilePage')}
      >
        <div className={styles.iconWrapper}>
          {currentUser?.avatar ? (
            <Avatar
              src={currentUser.avatar}
              name={currentUser?.displayName}
              size="22px"
              className={isProfileActive ? styles.activeAvatarBorder : ''}
            />
          ) : (
            // Deliberately NOT run through <NavIcon>: the Profile tab usually
            // shows the user's avatar, and cross-fading a fill under a photo
            // that is only sometimes there would make this one tab behave
            // differently from itself. Left exactly as it was.
            isProfileActive ? <ProfileSolid /> : <ProfileOutline />
          )}
        </div>
        <span>Profile</span>
      </button>
    </div>
  );
}
