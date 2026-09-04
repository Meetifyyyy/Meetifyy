import { useState } from 'react';
import { useAuth } from '@shared/context/AuthContext';

import { useLocation } from 'react-router-dom';
import { useSmartNavigation } from '@shared/hooks/useSmartNavigation';
import { isImageUrl } from '@shared/utils/avatar';
import { getMediaUrl } from '@shared/api/apiClient';
import DefaultAvatar from '@shared/components/avatar/DefaultAvatar';
import NavIcon from './NavIcon';
import { CampusOutline, CampusSolid } from './CampusIcon';
import { CrewOutline, CrewSolid } from './CrewIcon';
import { MessagesOutline, MessagesSolid } from './MessageIcon';
import styles from './Sidebar.module.css';
import {
  HomeIcon as HomeOutline,
  UserGroupIcon as CommunitiesOutline,
  UserIcon as ProfileOutline,
  Cog6ToothIcon as SettingsOutline,
  ChevronDownIcon,
  ChevronUpIcon,
  BellIcon as BellOutline,
} from '@heroicons/react/24/outline';
import {
  HomeIcon as HomeSolid,
  UserGroupIcon as CommunitiesSolid,
  UserIcon as ProfileSolid,
  Cog6ToothIcon as SettingsSolid,
  BellIcon as BellSolid,
} from '@heroicons/react/24/solid';
import NotificationBell from '@features/notifications/components/NotificationBell';

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

import { useJoinedCommunities } from '@shared/hooks/useCommunities';

export default function Sidebar({ onCommunityClick }) {
  const { initial, currentUser } = useAuth();
  const { total: unreadMessagesCount } = useUnreadCounts();
  const { smartNavigate: navigate } = useSmartNavigation();
  const location = useLocation();
  const [isCommunitiesMenuOpen, setIsCommunitiesMenuOpen] = useState(false);

  const username = currentUser?.username || '';
  
  // Shared with <Header>; see useJoinedCommunities.
  const joinedCommunityObjects = useJoinedCommunities();

  return (
    <aside className={styles.sidebar}>
      

      {/* 2. Navigation Card */}
      <div className={`${styles.sidebarCard} ${styles.navCard}`}>
        <nav className={styles.sidebarNav}>
          <a
            href="#"
            className={`${styles.sidebarLink}${location.pathname === '/home' ? ` ${styles.active}` : ''}`}
            onClick={(e) => { e.preventDefault(); navigate('/home'); }}
            onMouseEnter={() => import('@features/feed/pages/FeedRoute')}
          >
            <NavIcon
              className={styles.navIcon}
              active={location.pathname === '/home'}
              outline={<HomeOutline />}
              solid={<HomeSolid />}
            />
            <span className={styles.linkText}>Home</span>
          </a>
          
          <a
            href="#"
            className={`${styles.sidebarLink}${location.pathname.startsWith('/messages') ? ` ${styles.active}` : ''}`}
            onClick={(e) => { 
              e.preventDefault(); 
              // smartNavigate already replaces when the target is the page we
              // are on, so re-tapping Messages never duplicates an entry —
              // while stepping out of an open thread stays a real push the
              // user can back out of.
              navigate('/messages', { state: { from: location.pathname } });
            }}
            onMouseEnter={() => import('@features/messages/pages/MessagesRoute')}
          >
            <NavIcon
              className={styles.navIcon}
              active={location.pathname.startsWith('/messages')}
              outline={<MessagesOutline />}
              solid={<MessagesSolid />}
            />
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
            onClick={(e) => { e.preventDefault(); navigate('/campus'); }}
            onMouseEnter={() => import('@features/campus/pages/CampusPage')}
          >
            <NavIcon
              className={styles.navIcon}
              active={location.pathname.startsWith('/campus')}
              outline={<CampusOutline />}
              solid={<CampusSolid />}
            />
            <span className={styles.linkText}>Campus</span>
          </a>

          <a
            href="#"
            className={`${styles.sidebarLink}${location.pathname.startsWith('/crew') ? ` ${styles.active}` : ''}`}
            onClick={(e) => { e.preventDefault(); navigate('/crew'); }}
            onMouseEnter={() => import('@features/crew/pages/FindYourCrewPage')}
          >
            <NavIcon
              className={styles.navIcon}
              active={location.pathname.startsWith('/crew')}
              outline={<CrewOutline />}
              solid={<CrewSolid />}
            />
            <span className={styles.linkText}>Find your crew</span>
          </a>

          <a
            href="#"
            className={`${styles.sidebarLink}${location.pathname.startsWith('/notifications') ? ` ${styles.active}` : ''}`}
            onClick={(e) => { e.preventDefault(); navigate('/notifications'); }}
          >
            <NavIcon
              className={styles.navIcon}
              active={location.pathname.startsWith('/notifications')}
              outline={<BellOutline />}
              solid={<BellSolid />}
            />
            <span className={styles.linkText}>Notifications</span>
          </a>
          
          <a
            href="#"
            className={`${styles.sidebarLink}${location.pathname.startsWith('/profile') ? ` ${styles.active}` : ''}`}
            onClick={(e) => { e.preventDefault(); navigate(`/profile/${username}`); }}
            onMouseEnter={() => import('@features/profile/pages/ProfilePage')}
          >
            <NavIcon
              className={styles.navIcon}
              active={location.pathname.startsWith('/profile')}
              outline={<ProfileOutline />}
              solid={<ProfileSolid />}
            />
            <span className={styles.linkText}>Profile</span>
          </a>

          <a
            href="#"
            className={`${styles.sidebarLink}${location.pathname.startsWith('/settings') ? ` ${styles.active}` : ''}`}
            onClick={(e) => { e.preventDefault(); navigate('/settings'); }}
            onMouseEnter={() => import('@features/settings/pages/SettingsRoute')}
          >
            <NavIcon
              className={styles.navIcon}
              active={location.pathname.startsWith('/settings')}
              outline={<SettingsOutline />}
              solid={<SettingsSolid />}
            />
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
