import { useNavigate, useLocation } from 'react-router-dom';
import { useSmartNavigation } from '@shared/hooks/useSmartNavigation';
import { useAuth } from '@shared/context/AuthContext';
import Avatar from '@shared/components/avatar/Avatar';
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

const CompassOutline = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
  </svg>
);

const CompassSolid = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
  </svg>
);

const CampusOutline = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
    <path d="M6 12v5c0 2 2 3 6 3s6-1 6-3v-5" />
  </svg>
);

const CampusSolid = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
    <path d="M6 12v5c0 2 2 3 6 3s6-1 6-3v-5" strokeWidth="2.5" />
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
  const isPostOpen = location.pathname.startsWith('/post/');
  const isMessageChatOpen = location.pathname.startsWith('/messages/') && location.pathname.length > '/messages/'.length;
  const isInboxChatOpen = location.pathname.startsWith('/inbox/') && location.pathname.length > '/inbox/'.length;
  const isChatOpen = isMessageChatOpen || isInboxChatOpen;
  const isHidden = hidden || isPostOpen || isChatOpen;

  return (
    <div className={`app-bottom-nav ${styles.bottomNav} ${isHidden ? styles.hiddenNav : ''}`}>
      <button 
        className={`${styles.bottomNavItem}${isHomeActive ? ` ${styles.active}` : ''}`}
        onClick={() => handleTabClick('/home')}
        onMouseEnter={() => import('@features/feed/pages/FeedRoute')}
      >
        <div className={styles.iconWrapper}>
          {isHomeActive ? <HomeSolid /> : <HomeOutline />}
        </div>
        <span>Home</span>
      </button>

      <button 
        className={`${styles.bottomNavItem}${isCampusActive ? ` ${styles.active}` : ''}`}
        onClick={() => handleTabClick('/campus')}
        onMouseEnter={() => import('@features/campus/pages/CampusPage')}
      >
        <div className={styles.iconWrapper}>
          {isCampusActive ? <CampusSolid /> : <CampusOutline />}
        </div>
        <span>Campus</span>
      </button>

      <button 
        className={`${styles.bottomNavItem}${isMessagesActive ? ` ${styles.active}` : ''}`}
        onClick={() => handleTabClick('/messages')}
        onMouseEnter={() => import('@features/messages/pages/MessagesRoute')}
      >
        <div className={styles.iconWrapper}>
          {isMessagesActive ? <MessagesSolid /> : <MessagesOutline />}
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
          {isCrewActive ? <CompassSolid /> : <CompassOutline />}
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
            isProfileActive ? <ProfileSolid /> : <ProfileOutline />
          )}
        </div>
        <span>Profile</span>
      </button>
    </div>
  );
}
