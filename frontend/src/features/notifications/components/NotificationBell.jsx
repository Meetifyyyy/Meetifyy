import { Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { BellIcon as BellOutline } from '@heroicons/react/24/outline';
import { BellIcon as BellSolid } from '@heroicons/react/24/solid';
import NavIcon from '@layout/NavIcon';
import { useNotifications } from '../../../shared/hooks/useNotifications';
import styles from './NotificationBell.module.css';

export default function NotificationBell() {
  const { unreadCount } = useNotifications();
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
          outline={<BellOutline />}
          solid={<BellSolid />}
        />
        
        <AnimatePresence>
          {unreadCount > 0 && (
            <motion.div
              key="badge"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 25 }}
              className={styles.badge}
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Link>
  );
}
