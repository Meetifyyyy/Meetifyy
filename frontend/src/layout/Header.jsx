import { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@shared/context/AuthContext';
import { useData } from '@shared/context/DataContext';
import { showToast } from '@shared/utils/toast';
import Avatar from '@shared/components/Avatar';
import GlobalSearch from '@features/search/components/GlobalSearch';
import { useNotifications } from '@shared/context/NotificationContext';
import { useTheme } from '@shared/context/ThemeContext';
import { isImageUrl } from '@shared/utils/avatar';
import {
  UserGroupIcon as CommunitiesOutline,
  ChevronDownIcon,
  ChevronUpIcon,
  Cog6ToothIcon as SettingsIcon,
} from '@heroicons/react/24/outline';
import styles from './Header.module.css';

const DrawerCommunityItem = ({ comm, navigate, onClose }) => {
  const [imgError, setImgError] = useState(false);
  const isImage = isImageUrl(comm.avatar);

  return (
    <a
      href="#"
      className={styles.communityItem}
      onClick={(e) => { 
        e.preventDefault(); 
        navigate(`/communities/${comm.id}`); 
        onClose();
      }}
    >
      <div 
        className={styles.communityAvatar}
        style={{ background: (!isImage || imgError) ? (comm.color || 'var(--color-primary)') : 'var(--color-bg-white)' }}
      >
        {isImage && !imgError ? (
          <img src={comm.avatar} alt={comm.name} onError={() => setImgError(true)} />
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

export default function Header({ variant = 'dashboard' }) {
  const { initial, logout, currentUser } = useAuth();
  const { searchQuery, setSearchQuery, resetDataState, communities } = useData();
  const { unreadCount } = useNotifications();
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
    resetDataState();
    logout();
    navigate('/');
  };

  const username = currentUser?.username || '';
  const joinedCommunityObjects = (currentUser?.communities || []).map(commName => {
    return Object.values(communities || {}).find(c => c.name === commName) || { name: commName, id: commName.toLowerCase().replace(/\s+/g, ''), avatar: commName.charAt(0) };
  });

  return (
    <header className={`${styles.header} ${activeTab === 'messages' ? styles.headerMessages : ''} ${!isHomePage ? styles.hideOnMobile : ''}`}>
      {/* Mobile Header Left: Hamburger */}
      <button 
        className={styles.hamburgerBtn}
        onClick={() => setDrawerOpen(true)}
        aria-label="Open menu"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="4" y1="12" x2="20" y2="12"></line>
          <line x1="4" y1="6" x2="20" y2="6"></line>
          <line x1="4" y1="18" x2="20" y2="18"></line>
        </svg>
      </button>

      {/* Desktop/Default Left: Brand */}
      <div className={styles.navLeft}>
        <span className={styles.brand} onClick={() => navigate('/home')} style={{cursor: 'pointer'}}>Meetifyy</span>
      </div>

      {/* Side Drawer */}
      <div className={`${styles.mobileDrawer} ${drawerOpen ? styles.drawerOpen : ''}`}>
        <div className={styles.drawerHeader}>
          <span className={styles.brand} onClick={() => { navigate('/home'); setDrawerOpen(false); }} style={{cursor: 'pointer'}}>Meetifyy</span>
          <button className={styles.closeDrawerBtn} onClick={() => setDrawerOpen(false)}>✕</button>
        </div>
        
        <div className={styles.drawerContent}>
          {/* User Profile Info */}
          <div 
            className={styles.drawerProfile} 
            onClick={() => { navigate(`/profile/${username}`); setDrawerOpen(false); }}
          >
            <div className={styles.drawerProfileHeader}>
              <div style={{ width: 48, height: 48, flexShrink: 0 }}>
                <Avatar
                  src={currentUser?.avatar}
                  name={currentUser?.displayName}
                  size="100%"
                />
              </div>
              <div className={styles.drawerProfileInfo}>
                <span className={styles.drawerProfileName}>{currentUser?.displayName}</span>
                <span className={styles.drawerProfileUsername}>@{currentUser?.username}</span>
              </div>
            </div>
            
            <div className={styles.drawerProfileStats}>
              <div className={styles.statItem} onClick={(e) => { e.stopPropagation(); navigate(`/profile/${username}?tab=followers`); setDrawerOpen(false); }}>
                <span className={styles.statNumber}>{currentUser?.followers || 0}</span>
                <span className={styles.statLabel}>Followers</span>
              </div>
              <div className={styles.statItem} onClick={(e) => { e.stopPropagation(); navigate(`/profile/${username}?tab=following`); setDrawerOpen(false); }}>
                <span className={styles.statNumber}>{currentUser?.following || 0}</span>
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
                {joinedCommunityObjects.map(comm => (
                  <DrawerCommunityItem 
                    key={comm.id} 
                    comm={comm} 
                    navigate={navigate} 
                    onClose={() => setDrawerOpen(false)} 
                  />
                ))}
                
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
            onClick={toggleTheme}
            aria-label="Toggle theme"
            title="Toggle theme"
          >
            {theme === 'light' ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5"></circle>
                <line x1="12" y1="1" x2="12" y2="3"></line>
                <line x1="12" y1="21" x2="12" y2="23"></line>
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
                <line x1="1" y1="12" x2="3" y2="12"></line>
                <line x1="21" y1="12" x2="23" y2="12"></line>
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
              </svg>
            )}
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
          <button
            className={`${styles.notifIcon} ${styles.themeToggleBtn} ${styles.desktopOnlyTheme}`}
            aria-label="Toggle theme"
            title="Toggle theme"
            onClick={toggleTheme}
          >
            {theme === 'light' ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5"></circle>
                <line x1="12" y1="1" x2="12" y2="3"></line>
                <line x1="12" y1="21" x2="12" y2="23"></line>
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
                <line x1="1" y1="12" x2="3" y2="12"></line>
                <line x1="21" y1="12" x2="23" y2="12"></line>
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
              </svg>
            )}
          </button>
          <div style={{ position: 'relative' }} ref={notifRef}>
            <button
              className={styles.notifIcon}
              aria-label="Notifications"
              title="Notifications"
              onClick={(e) => { e.stopPropagation(); navigate('/notifications'); setDropdownOpen(false); }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              {unreadCount > 0 && (
                <div style={{
                  position: 'absolute',
                  top: 2,
                  right: 2,
                  minWidth: 16,
                  height: 16,
                  padding: '0 4px',
                  background: 'var(--color-danger)',
                  borderRadius: 8,
                  border: '2px solid var(--color-bg-white)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.6rem',
                  fontWeight: 700,
                  color: '#fff',
                  lineHeight: 1,
                }}>
                  {unreadCount > 9 ? '9+' : unreadCount}
                </div>
              )}
            </button>

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
                src={currentUser?.avatar}
                name={currentUser?.displayName}
                size="100%"
              />
            </div>
            <div className={`${styles.dropdown} ${dropdownOpen ? styles.dropdownOpen : ''}`} ref={dropdownRef}>
              <button 
                className={styles.dropdownProfileBtn}
                onClick={() => { navigate(`/profile/${username}`); setDropdownOpen(false); }}
              >
                <div style={{ width: 32, height: 32, flexShrink: 0 }}>
                  <Avatar
                    src={currentUser?.avatar}
                    name={currentUser?.displayName}
                    size="100%"
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
