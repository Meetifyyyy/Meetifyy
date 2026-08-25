import { useState, useMemo } from 'react';
import { useAuth } from '@shared/context/AuthContext';
import { toggleRegistry } from '@shared/utils/mutationRegistry';

import { useLocation } from 'react-router-dom';
import { useSmartNavigation } from '@shared/hooks/useSmartNavigation';
import { isImageUrl } from '@shared/utils/avatar';
import { getMediaUrl } from '@shared/api/apiClient';
import DefaultAvatar from '@shared/components/avatar/DefaultAvatar';
import NavIcon from './NavIcon';
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

import { useCommunities, useCampusCommunities } from '@shared/hooks/useCommunities';

export default function Sidebar({ onCommunityClick }) {
  const { initial, currentUser } = useAuth();
  const { communities } = useCommunities();
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
              outline={<CompassOutline />}
              solid={<CompassSolid />}
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
