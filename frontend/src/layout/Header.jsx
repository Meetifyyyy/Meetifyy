import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '@shared/hooks/useScrollLock';
import { useOverlayBack } from '@shared/hooks/useOverlayBack';
import { usePageTransition } from '@shared/hooks/usePageTransition';
import { useProfile } from '@shared/hooks/useProfile';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@shared/context/AuthContext';
import { Bookmark, Moon, Sun, MenuSquare, X, Settings, LogOut } from '@shared/components/icons';
import Menu, { MenuItem, MenuSeparator, useMenu } from '@shared/components/ui/Menu';
import ActionDot from '@shared/components/ActionDot';
import { useProfileActionNeeded } from '@shared/hooks/useProfileActionNeeded';
import CommunitiesBox from './CommunitiesBox';

import Avatar from '@shared/components/avatar/Avatar';
import GlobalSearch from '@features/search/components/GlobalSearch';
import { useTheme } from '@shared/context/ThemeContext';
import NotificationBell from '@features/notifications/components/NotificationBell';
import {
  Cog6ToothIcon as SettingsIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import styles from './Header.module.css';
import wordmark from '@assets/images/meetifyy_wordmark.svg';
import dashboardStyles from './DashboardLayout.module.css';

/** Match the .mobileDrawer transform transitions in Header.module.css. */
const DRAWER_ENTER_MS = 340;
const DRAWER_EXIT_MS = 250;

export default function Header({ variant = 'dashboard', wide = false }) {
  const { loading, logout, currentUser } = useAuth();
  const { theme, choice, toggleTheme } = useTheme();
  const menu = useMenu();
  const profileAction = useProfileActionNeeded();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // Freeze the page while the drawer is open. Without this, scrolling over
  // the drawer scrolled the feed behind it — and closing the drawer left the
  // user somewhere else entirely on the page they started from.
  //
  // The lock follows the drawer one slide later, in both directions. Engaging
  // it walks every element under #root with getComputedStyle, and releasing it
  // restyles every scroll container it froze; done on the same frame as the
  // class change, either one stalled the first frames of the slide on the APK.
  // During the 300ms in between the scrim already covers the page.
  const [scrollLocked, setScrollLocked] = useState(false);
  useEffect(() => {
    if (drawerOpen === scrollLocked) return undefined;
    const timer = setTimeout(
      () => setScrollLocked(drawerOpen),
      drawerOpen ? DRAWER_ENTER_MS : DRAWER_EXIT_MS,
    );
    return () => clearTimeout(timer);
  }, [drawerOpen, scrollLocked]);
  useScrollLock(scrollLocked);

  // Back closes the drawer instead of leaving the page it was opened over.
  // The drawer is portalled to <body> and holds a scroll lock, so a Back press
  // that changed the route used to strand a locked, half-open drawer on the
  // next page — the same failure the Instant Match sheet had.
  useOverlayBack(drawerOpen, closeDrawer);

  // Escape closes it, like every other overlay in the app.
  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setDrawerOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen]);
  const navigate = useNavigate();
  // In the app, Settings and Search slide in over the current page
  // (shared/lib/navigation/pageTransition.js); plain navigations on the website.
  const { open: openPage } = usePageTransition();
  const location = useLocation();
  const activeTab = location.pathname.startsWith('/messages') ? 'messages' : '';

  // Navigating closes the drawer. It is portalled to <body> now, so it no
  // longer vanishes along with the header on routes that hide the header —
  // without this it could stay open over a page with no way to dismiss it.
  // Declared after `location`: reading it above its own declaration throws.
  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);
  const isHomePage = location.pathname === '/home' || location.pathname === '/';
  const avatarRef = useRef(null);

  /*
   * The document-wide close listener is gone — `Menu` owns dismissal, and this
   * one fired on EVERY click in the app whether the menu was open or not.
   */

  const handleLogout = () => {
    // `logout` signs this tab out synchronously and resets the query cache as
    // part of that. Clearing the cache here too, first, only made the still
    // mounted signed-in pages refetch against a session that was ending.
    logout();
    // Replace, don't push: pushing left the authenticated page one entry behind
    // the landing page, so Back after signing out walked straight back into it.
    navigate('/', { replace: true });
  };

  const username = currentUser?.username || '';

  /*
   * The drawer's follower/following counts.
   *
   * These came straight off `currentUser`, which is the sign-in snapshot and
   * carries `followersList`/`followingList` arrays but no `stats` object and
   * no numeric counts. So the Followers chain — `stats?.followers ??
   * followers ?? 0` — had no path to a real value and rendered 0 for
   * everyone, permanently. Following only appeared to work because it fell
   * through to `followingList.length`.
   *
   * Both were also frozen at sign-in: following someone updates the
   * ['profile', username] query (useFollowMutation, and the realtime
   * follow/unfollow handler), never the auth object, so the drawer never
   * moved until the next full sync.
   *
   * Reading the profile query is what the desktop sidebar card already does.
   * It is the canonical store both of those writers target, so the counts
   * now track follows immediately and survive a reload. The auth lists stay
   * as a first-paint fallback for the moment before the query resolves.
   */
  //
  // Not on mount, though: the header is on every screen, and this put a
  // profile fetch into every launch alongside the feed. It is wanted when the
  // drawer opens, and it warms the Profile tab — so it waits for the drawer or
  // for the first screen to settle, whichever comes first.
  /*
   * Settings from the drawer.
   *
   * The route is a lazy chunk, and the router waits for it before switching:
   * the first tap used to sit through a network fetch while the drawer slid
   * shut over a page that had not changed yet, then Settings popped in after.
   * The chunk is fetched as soon as the drawer opens, so the switch lands with
   * the slide. (React Router 7 renders the route as a transition, so the
   * drawer's close still commits first.)
   *
   * Navigate BEFORE closing, as before: closing the drawer gives back its
   * history entry with an async go(-1), which the overlay manager skips once
   * the URL has moved on. Closing first and navigating later lets that pop
   * land after the push and take the user straight back out of Settings.
   */
  //
  // It starts once the slide has finished (and the browser is idle), not as
  // the drawer opens: opened early, the chunk's fetch, parse and evaluation
  // landed inside the first 300ms of the slide and stalled it. A tap on
  // Settings still warms it immediately (`onPointerDown`).
  const warmSettings = useCallback(() => {
    import('@features/settings/pages/SettingsRoute').catch(() => {});
  }, []);
  useEffect(() => {
    if (!drawerOpen) return undefined;
    let idle = null;
    const timer = setTimeout(() => {
      if ('requestIdleCallback' in window) idle = window.requestIdleCallback(warmSettings, { timeout: 1000 });
      else warmSettings();
    }, DRAWER_ENTER_MS);
    return () => {
      clearTimeout(timer);
      if (idle !== null) window.cancelIdleCallback(idle);
    };
  }, [drawerOpen, warmSettings]);
  /*
   * Close the drawer first and open the profile once its slide-out has
   * finished. Navigating in the same tap mounted the whole profile page in the
   * frame the slide began, so the drawer stuttered on its way out.
   *
   * `list` opens Followers/Following as a second history entry on top of the
   * profile (ProfilePage's `?tab=` is pushed state): Back then closes the list
   * and leaves you on the profile. Going straight to `?tab=` was one entry, so
   * Back skipped the profile altogether.
   */
  const openProfileFromDrawer = useCallback((list) => {
    const from = location.pathname;
    setDrawerOpen(false);
    window.setTimeout(() => {
      navigate(`/profile/${username}`, { state: { from } });
      // A separate task, so the profile entry renders (and the back tracker
      // records it) before the list is pushed on top. In the same tick the two
      // were batched, the list had nothing behind it, and its close did nothing.
      if (list) window.setTimeout(() => navigate(`/profile/${username}?tab=${list}`, { state: { from } }), 0);
    }, DRAWER_EXIT_MS);
  }, [navigate, username, location.pathname]);

  const openSettingsFromDrawer = useCallback(() => {
    // The drawer closes with the navigation, under the incoming page.
    openPage('/settings', {}, { onNavigate: () => setDrawerOpen(false) });
  }, [openPage]);

  const [profileWanted, setProfileWanted] = useState(false);
  useEffect(() => {
    if (profileWanted) return undefined;
    if (drawerOpen) {
      // After the slide: the fetch and the re-render when the counts arrive
      // used to land mid-slide.
      const t = setTimeout(() => setProfileWanted(true), DRAWER_ENTER_MS);
      return () => clearTimeout(t);
    }
    let idle = null;
    const timer = setTimeout(() => {
      if ('requestIdleCallback' in window) {
        idle = window.requestIdleCallback(() => setProfileWanted(true), { timeout: 3000 });
      } else {
        setProfileWanted(true);
      }
    }, 3000);
    return () => {
      clearTimeout(timer);
      if (idle !== null) window.cancelIdleCallback(idle);
    };
  }, [drawerOpen, profileWanted]);
  const { profile: ownProfile } = useProfile(username, { enabled: profileWanted });

  const followersCount =
    ownProfile?.stats?.followers
    ?? ownProfile?.followersCount
    ?? currentUser?.followersList?.length
    ?? 0;

  const followingCount =
    ownProfile?.stats?.following
    ?? ownProfile?.followingCount
    ?? currentUser?.followingList?.length
    ?? 0;

  return (
    <header className={`${styles.header} ${isHomePage ? styles.homeHeader : ''} ${activeTab === 'messages' ? styles.headerMessages : ''} ${!isHomePage ? styles.hideOnMobile : ''}`}>
      {/* Mobile Header Left: Sidebar / Menu Button */}
      <button 
        className={styles.hamburgerBtn}
        onClick={() => setDrawerOpen(true)}
        aria-label="Open sidebar"
      >
        <MenuSquare className={styles.headerIcon} size={22} strokeWidth={1.5} />
      </button>

      {/* Mobile Header Center: Brand Wordmark */}
      <div className={styles.mobileCenterBrand}>
        <img 
          src={wordmark} 
          alt="Meetifyy" 
          className={styles.mobileBrandWordmark} 
          onClick={() => navigate('/home')} 
        />
      </div>

      {/* Desktop/Default Left: Brand */}
      <div className={styles.navLeft}>
        <img 
          src={wordmark} 
          alt="Meetifyy" 
          className={styles.brandWordmark} 
          onClick={() => navigate('/home')} 
        />
      </div>

      {/* Side Drawer — portalled to <body>.
          It must not live inside <header>: the header takes a transform
          (and a will-change) on mobile to slide away on scroll, and either
          one makes it the containing block for `position: fixed`
          descendants. The drawer then resolved top/left/bottom against the
          60px header box instead of the viewport, collapsing to that strip
          — its background covered only the header row while its contents
          spilled transparently over the feed.
          `data-scroll-lock-ignore` is belt-and-braces: outside #root the
          lock's walk cannot reach it anyway, but the marker keeps that true
          if it is ever moved back. */}
      {createPortal(
        <>
      <div
        className={`${styles.mobileDrawer} ${drawerOpen ? styles.drawerOpen : ''}`}
        data-scroll-lock-ignore
        inert={!drawerOpen ? '' : undefined}
      >
        <div className={styles.drawerHeader}>
          <img 
            src={wordmark} 
            alt="Meetifyy" 
            className={styles.drawerWordmark} 
            onClick={() => { navigate('/home'); setDrawerOpen(false); }} 
          />
          <button className={styles.closeDrawerBtn} onClick={closeDrawer} aria-label="Close menu">
            <X size={18} strokeWidth={2} />
          </button>
        </div>
        
        <div className={styles.drawerContent}>
          {/* User Profile Card */}
          <div 
            className={styles.drawerProfile} 
            onClick={() => openProfileFromDrawer()}
            role="button"
            tabIndex={0}
            aria-label="View profile"
          >
            <div className={styles.drawerProfileHeader}>
              <div className={styles.drawerAvatarWrap}>
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
              <div 
                className={styles.statItem} 
                onClick={(e) => { 
                  e.stopPropagation();
                  openProfileFromDrawer('followers');
                }}
              >
                <span className={styles.statNumber}>{followersCount.toLocaleString()}</span>
                <span className={styles.statLabel}>Followers</span>
              </div>
              <div 
                className={styles.statItem} 
                onClick={(e) => { 
                  e.stopPropagation();
                  openProfileFromDrawer('following');
                }}
              >
                <span className={styles.statNumber}>{followingCount.toLocaleString()}</span>
                <span className={styles.statLabel}>Following</span>
              </div>
            </div>
          </div>

          {/* Communities Box */}
          <CommunitiesBox onItemClick={closeDrawer} className={styles.drawerCommunitiesBox} />
        </div>

        {/* Sticky Drawer Bottom: Settings and Theme Toggle */}
        <div className={styles.drawerBottom}>
          <button
            type="button"
            className={styles.drawerSettingsBtn}
            onClick={openSettingsFromDrawer}
            onPointerDown={warmSettings}
          >
            <SettingsIcon className={styles.settingsIcon} aria-hidden="true" />
            <span>Settings</span>
          </button>
          
          <button
            className={styles.drawerThemeToggleBtn}
            data-theme-toggle="true"
            onClick={(e) => {
              e.stopPropagation();
              const btn = e.currentTarget;
              toggleTheme({ originElement: btn });
            }}
            aria-label="Toggle theme"
            title={choice === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
          >
            {/* Both icons stay mounted and turn through each other with CSS
                transitions, following the latest press (`choice`), not the
                page's theme. A transition can be turned round mid-way, so
                rapid presses swing the icon back and forth smoothly; the old
                remount replayed its animation from the start on every switch
                and lagged a press whenever the page's circle reversed. */}
            <span className={styles.themeToggleIcon} data-choice={choice}>
              <span className={styles.themeIconMoon}><Moon size={20} /></span>
              <span className={styles.themeIconSun}><Sun size={20} /></span>
            </span>
          </button>
        </div>
      </div>
      <div
        className={`${styles.drawerOverlay} ${drawerOpen ? styles.drawerOverlayOpen : ''}`}
        onClick={() => setDrawerOpen(false)}
        aria-hidden="true"
      />
        </>,
        document.body,
      )}

      {/* Center Search Bar — always uses the 3-col dashboard grid overlay
          so the search bar sits in the same column (and therefore has the
          same width and left offset) as the center feed on every section. */}
      {variant === 'dashboard' && (
        <div className={`${dashboardStyles.dashboard} ${styles.headerGridAbsolute}`}>
          <div className={styles.gridEmptyCol} />
          <div className={styles.headerSearchGridMode}>
            <GlobalSearch />
          </div>
          <div className={styles.gridEmptyCol} />
        </div>
      )}

      {variant === 'dashboard' ? (
        <nav className={styles.nav}>
          {/* Mobile Search Button */}
          <button
            type="button"
            className={styles.mobileSearchBtn}
            onClick={() => openPage('/search', { state: { autoFocus: true } })}
            aria-label="Search"
          >
            <MagnifyingGlassIcon className={styles.headerIcon} strokeWidth={1.75} />
          </button>

          <div style={{ position: 'relative' }}>
            <NotificationBell />
          </div>
          <div className={`${styles.avatarWrap} ${styles.desktopOnlyAvatar}`}>
            <div
              /*
                Two owners for one node: the menu anchors to it, and the theme
                toggle animates its reveal from it. Spreading `triggerProps`
                after `ref={avatarRef}` would have silently replaced the second
                with the first, and the theme transition would have lost its
                origin — so both are assigned here instead.
              */
              ref={(el) => {
                avatarRef.current = el;
                menu.triggerRef.current = el;
              }}
              data-header-avatar="true"
              className={styles.userAvatar}
              onClick={menu.toggle}
              aria-haspopup="menu"
              aria-expanded={menu.open}
              role="button"
              aria-label="User menu"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { menu.toggle(e); } }}
            >
              <Avatar
                src={currentUser?.avatar || currentUser?.avatarUrl}
                name={currentUser?.displayName}
                size="42px"
                isLoading={loading}
              />
            </div>
            <Menu {...menu.menuProps} size="lg" ariaLabel="Account menu">
              {/*
                A custom row, not a MenuItem: it carries an avatar and two
                lines of text. `Menu` takes children rather than an items
                array precisely so a call site can do this without the shared
                component growing a variant for it.
              */}
              <button
                type="button"
                role="menuitem"
                className={styles.dropdownProfileBtn}
                onClick={() => {
                  navigate(`/profile/${username}`, { state: { from: location.pathname } });
                  menu.close();
                }}
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

              <MenuSeparator />

              <MenuItem icon={Bookmark} onSelect={() => navigate('/saved')} onClose={menu.close}>
                Saved
              </MenuItem>

              <MenuItem icon={Settings} onSelect={() => navigate('/settings')} onClose={menu.close}>
                Settings
                {profileAction.any && <ActionDot />}
              </MenuItem>

              <MenuItem
                icon={theme === 'light' ? Moon : Sun}
                onSelect={() => toggleTheme({ originElement: avatarRef.current })}
                onClose={menu.close}
              >
                {theme === 'light' ? 'Dark mode' : 'Light mode'}
              </MenuItem>

              <MenuSeparator />

              <MenuItem icon={LogOut} tone="danger" onSelect={handleLogout}>
                Log out
              </MenuItem>
            </Menu>
          </div>
        </nav>
      ) : (
        <nav className={styles.nav}>
          <a href="/">Home</a>
          <a href="#features">Features</a>
          <a href="#about">About</a>
          <a href="/help-and-support">Help &amp; Support</a>
        </nav>
      )}
    </header>
  );
}
