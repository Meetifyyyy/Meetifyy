import { useAuth } from '@shared/context/AuthContext';
import { useLayoutEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useSmartNavigation } from '@shared/hooks/useSmartNavigation';
import NavIcon from './NavIcon';
import { tabPrefetch } from './tabPrefetch';
import { CampusOutline, CampusSolid } from './CampusIcon';
import { CrewOutline, CrewSolid } from './CrewIcon';
import { MessagesOutline, MessagesSolid } from './MessageIcon';
import CommunitiesBox from './CommunitiesBox';
import ActionDot from '@shared/components/ActionDot';
import { useProfileActionNeeded } from '@shared/hooks/useProfileActionNeeded';
import styles from './Sidebar.module.css';
import {
  HomeIcon as HomeOutline,
  UserIcon as ProfileOutline,
  Cog6ToothIcon as SettingsOutline,
  BellIcon as BellOutline,
} from '@heroicons/react/24/outline';
import {
  HomeIcon as HomeSolid,
  UserIcon as ProfileSolid,
  Cog6ToothIcon as SettingsSolid,
  BellIcon as BellSolid,
} from '@heroicons/react/24/solid';
import { useUnreadCounts } from '@features/messages/hooks/useUnreadCounts';

export default function Sidebar() {
  const { currentUser } = useAuth();
  const { total: unreadMessagesCount } = useUnreadCounts();
  const { smartNavigate: navigate } = useSmartNavigation();
  const location = useLocation();
  const profileAction = useProfileActionNeeded();

  const username = currentUser?.username || '';

  // A pill behind the active link that glides to the new one on navigation.
  const navRef = useRef(null);
  const [pill, setPill] = useState(null);
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return undefined;
    const measure = () => {
      const active = nav.querySelector(`.${styles.active}`);
      setPill((prev) => {
        const next = active ? { top: active.offsetTop, height: active.offsetHeight } : null;
        if (prev && next && prev.top === next.top && prev.height === next.height) return prev;
        return next ? { ...next, animate: Boolean(prev) } : null;
      });
    };
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(nav);
    return () => observer?.disconnect();
  }, [location.pathname]);

  return (
    <aside className={styles.sidebar}>
      

      {/* 2. Navigation Card */}
      <div className={`${styles.sidebarCard} ${styles.navCard}`}>
        <nav className={styles.sidebarNav} ref={navRef}>
          {pill && (
            <span
              className={`${styles.activePill}${pill.animate ? ` ${styles.activePillMoving}` : ''}`}
              style={{ transform: `translateY(${pill.top}px)`, height: `${pill.height}px` }}
              aria-hidden="true"
            />
          )}
          <a
            href="#"
            className={`${styles.sidebarLink}${location.pathname === '/home' ? ` ${styles.active}` : ''}`}
            onClick={(e) => { e.preventDefault(); navigate('/home'); }}
            {...tabPrefetch.handlersFor('home')}
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
            {...tabPrefetch.handlersFor('messages')}
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
            {...tabPrefetch.handlersFor('campus')}
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
            {...tabPrefetch.handlersFor('crew')}
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
            {...tabPrefetch.handlersFor('profile')}
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
            {profileAction.any && <ActionDot />}
          </a>
        </nav>
      </div>

      {/* Communities Boxed Menu */}
      <CommunitiesBox />
    </aside>
  );
}
