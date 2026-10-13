import PageHeader from '@layout/PageHeader';
import styles from '../pages/NotificationsRoute.module.css';
import NotificationsLoading from './NotificationsLoading';

const HEADER_TABS = [
  { id: 'all', label: 'All notifications' },
  { id: 'invitations', label: 'Invitations' },
];

/**
 * Shown while the Notifications route's chunk loads: the real header in the
 * same wrapper the route uses (so nothing moves when the route replaces it)
 * and a spinner where the list goes.
 */
export default function NotificationsPageFallback() {
  return (
    <main className="centre centre-wide animate-in">
      <div className={styles.page}>
        <div className={styles.headerArea}>
          <PageHeader title="Notifications" backPath="/home" tabs={HEADER_TABS} activeTab="all" />
        </div>
        <div className={styles.list}>
          <NotificationsLoading />
        </div>
      </div>
    </main>
  );
}
