import { Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useNotifications } from '../../../shared/hooks/useNotifications';
import styles from './NotificationBell.module.css';

export default function NotificationBell() {
  const { unreadCount } = useNotifications();
  const location = useLocation();
  const isActive = location.pathname.startsWith('/notifications');

  return (
    <Link to="/notifications" className={`${styles.bellWrapper} ${isActive ? styles.active : ''}`}>
      <div className={styles.iconContainer}>
        {isActive ? (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 22C13.1 22 14 21.1 14 20H10C10 21.1 10.89 22 12 22ZM18 16V11C18 7.93 16.36 5.36 13.5 4.68V4C13.5 3.17 12.83 2.5 12 2.5C11.17 2.5 10.5 3.17 10.5 4V4.68C7.63 5.36 6 7.92 6 11V16L4 18V19H20V18L18 16Z" />
          </svg>
        ) : (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
          </svg>
        )}
        
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
