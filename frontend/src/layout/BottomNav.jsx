import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@shared/context/AuthContext';
import Avatar from '@shared/components/avatar/Avatar';
import styles from './BottomNav.module.css';
import {
  HomeIcon as HomeOutline,
  ChatBubbleOvalLeftEllipsisIcon as MessagesOutline,
  BellIcon as BellOutline,
} from '@heroicons/react/24/outline';
import {
  HomeIcon as HomeSolid,
  ChatBubbleOvalLeftEllipsisIcon as MessagesSolid,
  BellIcon as BellSolid,
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

export default function BottomNav() {
  const navigate = useNavigate();
  const location = useLocation();

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

  const isChatOpen = location.pathname.startsWith('/messages/') && location.pathname !== '/messages/';
  const isPostOpen = location.pathname.startsWith('/post/');
  if (isChatOpen || isPostOpen) return null;

  return (
    <div className={styles.bottomNav}>
      <button 
        className={`${styles.bottomNavItem}${isHomeActive ? ` ${styles.active}` : ''}`}
        onClick={() => handleTabClick('/home')}
        onMouseEnter={() => import('@features/feed/pages/FeedRoute')}
      >
        {isHomeActive ? <HomeSolid /> : <HomeOutline />}
        <span>Home</span>
      </button>

      <button 
        className={`${styles.bottomNavItem}${isCampusActive ? ` ${styles.active}` : ''}`}
        onClick={() => handleTabClick('/campus')}
        onMouseEnter={() => import('@features/campus/pages/CampusPage')}
      >
        {isCampusActive ? <CampusSolid /> : <CampusOutline />}
        <span>Campus</span>
      </button>

      <button 
        className={`${styles.bottomNavItem}${isMessagesActive ? ` ${styles.active}` : ''}`}
        onClick={() => handleTabClick('/messages')}
        onMouseEnter={() => import('@features/messages/pages/MessagesRoute')}
      >
        {isMessagesActive ? <MessagesSolid /> : <MessagesOutline />}
        <span>Messages</span>
      </button>

      <button 
        className={`${styles.bottomNavItem}${isCrewActive ? ` ${styles.active}` : ''}`}
        onClick={() => handleTabClick('/crew')}
        onMouseEnter={() => import('@features/crew/pages/FindYourCrewPage')}
      >
        {isCrewActive ? <CompassSolid /> : <CompassOutline />}
        <span>Crew</span>
      </button>

      <button 
        className={`${styles.bottomNavItem}${isNotificationsActive ? ` ${styles.active}` : ''}`}
        onClick={() => handleTabClick('/notifications')}
      >
        {isNotificationsActive ? <BellSolid /> : <BellOutline />}
        <span>Alerts</span>
      </button>

      <button 
        className={`${styles.bottomNavItem}${isProfileActive ? ` ${styles.active}` : ''}`}
        onClick={() => handleTabClick(`/profile/${username}`)}
        onMouseEnter={() => import('@features/profile/pages/ProfilePage')}
      >
        <Avatar
          src={currentUser?.avatar}
          name={currentUser?.displayName}
          size="24px"
          className={isProfileActive ? styles.activeAvatarBorder : ''}
        />
        <span>Profile</span>
      </button>
    </div>
  );
}
