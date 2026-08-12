import { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@shared/context/AuthContext';
import { useCommunities, useCampusCommunities } from '@shared/hooks/useCommunities';
import { useData } from '@shared/hooks/useData';
import { toggleRegistry } from '@shared/utils/mutationRegistry';
import { Sun, Moon } from 'lucide-react';

import useUIStore from '@stores/uiStore';
import { showToast } from '@shared/utils/toast';
import Avatar from '@shared/components/avatar/Avatar';
import GlobalSearch from '@features/search/components/GlobalSearch';
import { useTheme } from '@shared/context/ThemeContext';
import NotificationBell from '@features/notifications/components/NotificationBell';
import { isImageUrl } from '@shared/utils/avatar';
import {
  UserGroupIcon as CommunitiesOutline,
  ChevronDownIcon,
  ChevronUpIcon,
  Cog6ToothIcon as SettingsIcon,
} from '@heroicons/react/24/outline';
import styles from './Header.module.css';
import wordmark from '@assets/images/meetifyy_wordmark.svg';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { communitiesApi, getMediaUrl } from '@shared/api/apiClient';

const DrawerCommunityItem = ({ comm, navigate, onClose }) => {
  const location = useLocation();
  const [imgError, setImgError] = useState(false);
  const isImage = isImageUrl(comm.avatar);
  const avatarSrc = isImage ? getMediaUrl(comm.avatar) : '';

  return (
    <a
      href="#"
      className={styles.communityItem}
      onClick={(e) => { 
        e.preventDefault(); 
        navigate(`/communities/${comm.id}`, { state: { from: location.pathname } }); 
        onClose();
      }}
    >
      <div 
        className={styles.communityAvatar}
        style={{ background: (!isImage || imgError) ? (comm.color || 'var(--color-primary)') : 'transparent' }}
      >
        {isImage && !imgError ? (
          <img src={avatarSrc} alt={comm.name} onError={() => setImgError(true)} />
        ) : (
          <span style={{ color: '#FFFFFF', fontWeight: 700 }}>
            {comm.name ? comm.name.charAt(0).toUpperCase() : 'C'}
          </span>
        )}
      </div>
      <span>{comm.name}</span>
    </a>
  );
};

export default function Header({ variant = 'dashboard' }) {
  const { loading, logout, currentUser } = useAuth();
  const queryClient = useQueryClient();
  const { communities: communitiesDataMap } = useCommunities();
  const communities = communitiesDataMap || {};
  
  const searchQuery = useUIStore(state => state.searchQuery);
  const setSearchQuery = useUIStore(state => state.setSearchQuery);
  const { theme, toggleTheme } = useTheme();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isCommunitiesMenuOpen, setIsCommunitiesMenuOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const activeTab = location.pathname.startsWith('/messages') ? 'messages' : '';
  const isHomePage = location.pathname === '/home' || location.pathname === '/';
  const dropdownRef = useRef(null);
  const notifRef = useRef(null);
  const avatarRef = useRef(null);

  useEffect(() => {
    const close = () => {
      setDropdownOpen(false);
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

  const handleLogout = () => {
    queryClient.clear();
    logout();
    navigate('/');
  };

  const { communities: allCommunitiesData } = useData();
  const { campusCommunities } = useCampusCommunities();

  const username = currentUser?.username || '';

  const joinedCommunityObjects = useMemo(() => {
    const publicList = Array.isArray(allCommunitiesData) ? allCommunitiesData : Object.values(allCommunitiesData || communities || {});
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
  }, [allCommunitiesData, campusCommunities, communities, currentUser]);

  return (
    <header className={`${styles.header} ${activeTab === 'messages' ? styles.headerMessages : ''} ${!isHomePage ? styles.hideOnMobile : ''}`}>
      {/* Mobile Header Left: Hamburger */}
      <button 
        className={styles.hamburgerBtn}
        onClick={() => setDrawerOpen(true)}
        aria-label="Open menu"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="3.5" y1="5.5" x2="20.5" y2="5.5" />
          <line x1="3.5" y1="12" x2="16.5" y2="12" />
          <line x1="3.5" y1="18.5" x2="11.5" y2="18.5" />
        </svg>
      </button>

      {/* Desktop/Default Left: Brand */}
      <div className={styles.navLeft}>
        <img 
          src={wordmark} 
          alt="Meetifyy" 
          className={styles.brandWordmark} 
          onClick={() => navigate('/home')} 
        />
      </div>

      {/* Side Drawer */}
      <div className={`${styles.mobileDrawer} ${drawerOpen ? styles.drawerOpen : ''}`}>
        <div className={styles.drawerHeader}>
          <img 
            src={wordmark} 
            alt="Meetifyy" 
            className={styles.drawerWordmark} 
            onClick={() => { navigate('/home'); setDrawerOpen(false); }} 
          />
          <button className={styles.closeDrawerBtn} onClick={() => setDrawerOpen(false)}>✕</button>
        </div>
        
        <div className={styles.drawerContent}>
          {/* User Profile Info */}
          <div 
            className={styles.drawerProfile} 
            onClick={() => { navigate(`/profile/${username}`, { state: { from: location.pathname } }); setDrawerOpen(false); }}
          >
            <div className={styles.drawerProfileHeader}>
              <div style={{ width: 48, height: 48, flexShrink: 0 }}>
                <Avatar
                  src={currentUser?.avatar || currentUser?.avatarUrl}
                  name={currentUser?.displayName}
                  size="100%"
                  isLoading={loading}
                />
              </div>
              <div className={styles.drawerProfileInfo}>
                <span className={styles.drawerProfileName}>{currentUser?.displayName}</span>
                <span className={styles.drawerProfileUsername}>@{currentUser?.username}</span>
              </div>
            </div>
            
            <div className={styles.drawerProfileStats}>
              <div className={styles.statItem} onClick={(e) => { e.stopPropagation(); navigate(`/profile/${username}?tab=followers`, { state: { from: location.pathname } }); setDrawerOpen(false); }}>
                <span className={styles.statNumber}>{currentUser?.stats?.followers ?? currentUser?.followers ?? 0}</span>
                <span className={styles.statLabel}>Followers</span>
              </div>
              <div className={styles.statItem} onClick={(e) => { e.stopPropagation(); navigate(`/profile/${username}?tab=following`, { state: { from: location.pathname } }); setDrawerOpen(false); }}>
                <span className={styles.statNumber}>{currentUser?.stats?.following ?? currentUser?.followingList?.length ?? currentUser?.following ?? 0}</span>
                <span className={styles.statLabel}>Following</span>
              </div>
            </div>
          </div>

          {/* Communities Box (same behavior as left sidebar on desktop) */}
          <div className={styles.communitiesBox}>
            <div 
              className={styles.communitiesHeader} 
              onClick={() => setIsCommunitiesMenuOpen(!isCommunitiesMenuOpen)}
            >
              <span>COMMUNITIES</span>
              {isCommunitiesMenuOpen ? (
                <ChevronUpIcon className={styles.chevronIcon} />
              ) : (
                <ChevronDownIcon className={styles.chevronIcon} />
              )}
            </div>
            
            {isCommunitiesMenuOpen && (
              <div className={styles.communitiesList}>
                {joinedCommunityObjects.length > 0 ? (
                  joinedCommunityObjects.map(comm => (
                    <DrawerCommunityItem 
                      key={comm.id} 
                      comm={comm} 
                      navigate={navigate} 
                      onClose={() => setDrawerOpen(false)} 
                    />
                  ))
                ) : (
                  <div className={styles.emptyCommunities}>
                    No communities joined yet
                  </div>
                )}
                
                <a
                  href="#"
                  className={styles.exploreMore}
                  onClick={(e) => { e.preventDefault(); navigate('/communities'); setDrawerOpen(false); }}
                >
                  <CommunitiesOutline className={styles.exploreIcon} />
                  <span>Explore more...</span>
                </a>
              </div>
            )}
          </div>
        </div>

        {/* Sticky Drawer Bottom: Settings and Theme Toggle */}
        <div className={styles.drawerBottom}>
          <button 
            className={styles.drawerSettingsBtn}
            onClick={() => { navigate('/settings'); setDrawerOpen(false); }}
          >
            <SettingsIcon className={styles.settingsIcon} />
            <span>Settings</span>
          </button>
          
          <button
            className={styles.drawerThemeToggleBtn}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              toggleTheme({ clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 });
            }}
            aria-label="Toggle theme"
            title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
          >
            {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
          </button>
        </div>
      </div>
      {drawerOpen && <div className={styles.drawerOverlay} onClick={() => setDrawerOpen(false)} />}

      {/* Center Search Bar */}
      {variant === 'dashboard' && (
        <div className={styles.headerSearch}>
          <GlobalSearch />
        </div>
      )}

      {variant === 'dashboard' ? (
        <nav className={styles.nav}>
          <div style={{ position: 'relative' }} ref={notifRef}>
            <NotificationBell />
          </div>
          <div className={`${styles.avatarWrap} ${styles.desktopOnlyAvatar}`}>
            <div
              ref={avatarRef}
              className={styles.userAvatar}
              onClick={(e) => { e.stopPropagation(); setDropdownOpen(!dropdownOpen); setNotifOpen(false); }}
              role="button"
              aria-label="User menu"
              aria-expanded={dropdownOpen}
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); setDropdownOpen(!dropdownOpen); }}}
            >
              <Avatar
                src={currentUser?.avatar || currentUser?.avatarUrl}
                name={currentUser?.displayName}
                size="42px"
                isLoading={loading}
              />
            </div>
            <div className={`${styles.dropdown} ${dropdownOpen ? styles.dropdownOpen : ''}`} ref={dropdownRef}>
              <button 
                className={styles.dropdownProfileBtn}
                onClick={() => { navigate(`/profile/${username}`, { state: { from: location.pathname } }); setDropdownOpen(false); }}
              >
                <div style={{ width: 32, height: 32, flexShrink: 0 }}>
                  <Avatar
                    src={currentUser?.avatar || currentUser?.avatarUrl}
                    name={currentUser?.displayName}
                    size="32px"
                    isLoading={loading}
                  />
                </div>
                <div className={styles.dropdownProfileDetails}>
                  <span className={styles.dropdownProfileName}>{currentUser?.displayName}</span>
                  <span className={styles.dropdownProfileSubtitle}>View profile</span>
                </div>
              </button>

              <button 
                onClick={() => { navigate('/saved'); setDropdownOpen(false); }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                </svg>
                Saved
              </button>

              <button 
                onClick={() => { navigate('/settings'); setDropdownOpen(false); }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                </svg>
                Settings
              </button>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setDropdownOpen(false);
                  toggleTheme();
                }}
              >
                {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
                <span>{theme === 'light' ? 'Dark mode' : 'Light mode'}</span>
              </button>

              <div className={styles.divider} />

              <button className={styles.logoutBtn} onClick={handleLogout}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
                Log out
              </button>
            </div>
          </div>
        </nav>
      ) : (
        <nav className={styles.nav}>
          <a href="/">Home</a>
          <a href="#features">Features</a>
          <a href="#about">About</a>
          <a href="#contact">Contact</a>
        </nav>
      )}
    </header>
  );
}
