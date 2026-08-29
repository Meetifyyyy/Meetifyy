import { useNavigate, useLocation } from 'react-router-dom';
import { useSmartNavigation } from '@shared/hooks/useSmartNavigation';
import { useAuth } from '@shared/context/AuthContext';
import Avatar from '@shared/components/avatar/Avatar';
import NavIcon from './NavIcon';
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
            outline={<CrewOutline />}
            solid={<CrewSolid />}
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
