import { useState, useMemo } from 'react';
import { useData } from '@shared/hooks/useData';
import { useAuth } from '@shared/context/AuthContext';
import { toggleRegistry } from '@shared/utils/mutationRegistry';

import { useLocation } from 'react-router-dom';
import { useSmartNavigation } from '@shared/hooks/useSmartNavigation';
import { isImageUrl } from '@shared/utils/avatar';
import { getMediaUrl } from '@shared/api/apiClient';
import DefaultAvatar from '@shared/components/avatar/DefaultAvatar';
import styles from './Sidebar.module.css';
import {
  HomeIcon as HomeOutline,
  ChatBubbleOvalLeftEllipsisIcon as MessagesOutline,
  UserGroupIcon as CommunitiesOutline,
  UserIcon as ProfileOutline,
  Cog6ToothIcon as SettingsOutline,
  ChevronDownIcon,
  ChevronUpIcon,
  BellIcon as BellOutline,
} from '@heroicons/react/24/outline';
import {
  HomeIcon as HomeSolid,
  ChatBubbleOvalLeftEllipsisIcon as MessagesSolid,
  UserGroupIcon as CommunitiesSolid,
  UserIcon as ProfileSolid,
  Cog6ToothIcon as SettingsSolid,
  BellIcon as BellSolid,
} from '@heroicons/react/24/solid';
import NotificationBell from '@features/notifications/components/NotificationBell';

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

const SidebarCommunityItem = ({ comm, navigate }) => {
  const location = useLocation();
  const [imgError, setImgError] = useState(false);
  const isImage = isImageUrl(comm.avatar);
  const avatarSrc = isImage ? getMediaUrl(comm.avatar) : '';

  return (
    <a
      href="#"
      className={styles.communityItem}
      onClick={(e) => { e.preventDefault(); navigate(`/communities/${comm.id}`, { state: { from: location.pathname } }); }}
    >
      <div 
        className={styles.communityAvatar}
        style={{ background: (!isImage || imgError) ? (comm.color || 'var(--color-primary)') : 'var(--color-bg-white)' }}
      >
        {isImage && !imgError ? (
          <img src={avatarSrc} alt={comm.name} width="100%" height="100%" style={{ objectFit: 'cover', display: 'block' }} onError={() => setImgError(true)} />
        ) : (
          <span style={{ color: '#FFFFFF', fontWeight: 700 }}>
            {comm.avatar || (comm.name ? comm.name.charAt(0).toUpperCase() : '')}
          </span>
        )}
      </div>
      <span>{comm.name}</span>
    </a>
  );
};

import { useUnreadCounts } from '@features/messages/hooks/useUnreadCounts';

import { useCampusCommunities } from '@shared/hooks/useCommunities';

export default function Sidebar({ onCommunityClick }) {
  const { initial, currentUser } = useAuth();
  const { communities } = useData();
  const { campusCommunities } = useCampusCommunities();
  const { total: unreadMessagesCount } = useUnreadCounts();
  const { smartNavigate: navigate } = useSmartNavigation();
  const location = useLocation();
  const [isCommunitiesMenuOpen, setIsCommunitiesMenuOpen] = useState(false);

  const username = currentUser?.username || '';
  
  const joinedCommunityObjects = useMemo(() => {
    const publicList = Array.isArray(communities) ? communities : Object.values(communities || {});
    const campusList = Array.isArray(campusCommunities) ? campusCommunities : [];
    
    const combined = [...publicList, ...campusList].filter(c => c && typeof c === 'object' && c.name && c.id);
    const uniqueMap = new Map();
    combined.forEach(c => uniqueMap.set(c.id, c));
    const commList = Array.from(uniqueMap.values());

    const userCommunities = currentUser?.communities || [];

    return commList.filter((c) => {
      const rawJoined = Boolean(
        (c.ownerId && currentUser?.id && c.ownerId === currentUser.id) ||
        c.userRole === 'OWNER' ||
        c.userRole === 'MODERATOR' ||
        c.userRole === 'MEMBER' ||
        (c.isJoined !== undefined && Boolean(c.isJoined)) ||
        (c.isMember !== undefined && Boolean(c.isMember)) ||
        (Array.isArray(c.members) && currentUser?.id && c.members.some(m => (m.userId || m.id || m.user?.id) === currentUser.id)) ||
        userCommunities.includes(c.name) ||
        userCommunities.includes(c.id)
      );

      const entityKey = `joinCommunity:${c.id}`;
      return toggleRegistry.getLatestIntent(entityKey, rawJoined);
    });
  }, [communities, campusCommunities, currentUser]);

  return (
    <aside className={styles.sidebar}>
      

      {/* 2. Navigation Card */}
      <div className={`${styles.sidebarCard} ${styles.navCard}`}>
        <nav className={styles.sidebarNav}>
          <a
            href="#"
            className={`${styles.sidebarLink}${location.pathname === '/home' ? ` ${styles.active}` : ''}`}
            onClick={(e) => { e.preventDefault(); navigate('/home', { replace: true }); }}
            onMouseEnter={() => import('@features/feed/pages/FeedRoute')}
          >
            {location.pathname === '/home' ? (
              <HomeSolid />
            ) : (
              <HomeOutline />
            )}
            <span className={styles.linkText}>Home</span>
          </a>
          
          <a
            href="#"
            className={`${styles.sidebarLink}${location.pathname.startsWith('/messages') ? ` ${styles.active}` : ''}`}
            onClick={(e) => { 
              e.preventDefault(); 
              if (location.pathname.startsWith('/messages') || location.pathname.startsWith('/inbox')) {
                navigate('/messages', { replace: true, state: location.state });
              } else {
                navigate('/messages', { state: { from: location.pathname } });
              }
            }}
            onMouseEnter={() => import('@features/messages/pages/MessagesRoute')}
          >
            {location.pathname.startsWith('/messages') ? (
              <MessagesSolid />
            ) : (
              <MessagesOutline />
            )}
            <span className={styles.linkText}>Messages</span>
            {unreadMessagesCount > 0 && (
              <span className={styles.badge}>
                {unreadMessagesCount > 99 ? '99+' : unreadMessagesCount}
              </span>
            )}
          </a>

          <a
            href="#"
            className={`${styles.sidebarLink}${location.pathname.startsWith('/campus') ? ` ${styles.active}` : ''}`}
            onClick={(e) => { e.preventDefault(); navigate('/campus', { replace: true }); }}
            onMouseEnter={() => import('@features/campus/pages/CampusPage')}
          >
            {location.pathname.startsWith('/campus') ? (
              <CampusSolid />
            ) : (
              <CampusOutline />
            )}
            <span className={styles.linkText}>Campus</span>
          </a>

          <a
            href="#"
            className={`${styles.sidebarLink}${location.pathname.startsWith('/crew') ? ` ${styles.active}` : ''}`}
            onClick={(e) => { e.preventDefault(); navigate('/crew', { replace: true }); }}
            onMouseEnter={() => import('@features/crew/pages/FindYourCrewPage')}
          >
            {location.pathname.startsWith('/crew') ? (
              <CompassSolid />
            ) : (
              <CompassOutline />
            )}
            <span className={styles.linkText}>Find your crew</span>
          </a>

          <a
            href="#"
            className={`${styles.sidebarLink}${location.pathname.startsWith('/notifications') ? ` ${styles.active}` : ''}`}
            onClick={(e) => { e.preventDefault(); navigate('/notifications', { replace: true }); }}
          >
            {location.pathname.startsWith('/notifications') ? (
              <BellSolid />
            ) : (
              <BellOutline />
            )}
            <span className={styles.linkText}>Notifications</span>
          </a>
          
          <a
            href="#"
            className={`${styles.sidebarLink}${location.pathname.startsWith('/profile') ? ` ${styles.active}` : ''}`}
            onClick={(e) => { e.preventDefault(); navigate(`/profile/${username}`, { replace: true }); }}
            onMouseEnter={() => import('@features/profile/pages/ProfilePage')}
          >
            {location.pathname.startsWith('/profile') ? (
              <ProfileSolid />
            ) : (
              <ProfileOutline />
            )}
            <span className={styles.linkText}>Profile</span>
          </a>

          <a
            href="#"
            className={`${styles.sidebarLink}${location.pathname.startsWith('/settings') ? ` ${styles.active}` : ''}`}
            onClick={(e) => { e.preventDefault(); navigate('/settings', { replace: true }); }}
            onMouseEnter={() => import('@features/settings/pages/SettingsRoute')}
          >
            {location.pathname.startsWith('/settings') ? (
              <SettingsSolid />
            ) : (
              <SettingsOutline />
            )}
            <span className={styles.linkText}>Settings</span>
          </a>
        </nav>
      </div>

      {/* Communities Boxed Menu */}
      <div className={styles.communitiesBox}>
        <div 
          className={styles.communitiesHeader} 
          onClick={() => setIsCommunitiesMenuOpen(!isCommunitiesMenuOpen)}
        >
          <span>COMMUNITIES</span>
          <ChevronDownIcon className={`${styles.chevronIcon} ${isCommunitiesMenuOpen ? styles.rotated : ''}`} />
        </div>
        
        <div className={`${styles.communitiesListContainer} ${isCommunitiesMenuOpen ? styles.open : ''}`}>
          <div className={styles.communitiesList}>
            {joinedCommunityObjects.length > 0 ? (
              joinedCommunityObjects.map(comm => (
                <SidebarCommunityItem key={comm.id} comm={comm} navigate={navigate} />
              ))
            ) : (
              <div className={styles.emptyCommunities}>
                No communities joined yet
              </div>
            )}
            
            <a
              href="#"
              className={styles.exploreMore}
              onClick={(e) => { e.preventDefault(); navigate('/communities'); }}
            >
              <CommunitiesOutline className={styles.exploreIcon} />
              <span>Explore more...</span>
            </a>
          </div>
        </div>
      </div>
    </aside>
  );
}
