import { Link, useLocation } from 'react-router-dom';
import { BellIcon as BellOutline } from '@heroicons/react/24/outline';
import { BellIcon as BellSolid } from '@heroicons/react/24/solid';
import NavIcon from '@layout/NavIcon';
import { useUnreadNotificationCount } from '../../../shared/hooks/useNotifications';
import styles from './NotificationBell.module.css';

export default function NotificationBell() {
  // The count alone. `useNotifications()` also mounts the infinite feed query,
  // and this bell is in the header on every route — so every page in the app
  // was fetching page one of the notification list to render a number that
  // comes from a different endpoint entirely.
  const unreadCount = useUnreadNotificationCount();
  const location = useLocation();
  const isActive = location.pathname.startsWith('/notifications');

  return (
    <Link to="/notifications" className={`${styles.bellWrapper} ${isActive ? styles.active : ''}`}>
      <div className={styles.iconContainer}>
        {/* The same bell, and the same active treatment, as the left sidebar's
            Notifications link: Heroicons outline/solid through <NavIcon>, which
            cross-fades the pair instead of swapping one for the other. This
            used to be two hand-drawn bells of its own -- a different outline
            and a different solid from the sidebar's -- switched instantly. */}
        <NavIcon
          active={isActive}
          outline={<BellOutline strokeWidth={1.75} />}
          solid={<BellSolid />}
        />
        
        {/* A CSS pop-in, not framer-motion. This bell is in the header of
            every signed-in screen, so it was the one import that put the
            whole animation engine into the startup bundle. */}
        {unreadCount > 0 && (
          <div className={styles.badge}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </div>
        )}
      </div>
    </Link>
  );
}
