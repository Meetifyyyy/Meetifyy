import PageHeader from '@layout/PageHeader';
import styles from '../../pages/NotificationsRoute.module.css';
import NotificationRowsSkeleton from './NotificationRowsSkeleton';

export default function NotificationsSkeleton() {
  const headerTabs = [
    { id: 'all', label: 'All notifications' },
    { id: 'invitations', label: 'Invitations' }
  ];

  return (
    <main className="centre centre-wide animate-in">
      <div className={styles.page}>
        {/* Same wrapper the route uses, so the header does not move when the
            route replaces this. */}
        <div className={styles.headerArea}>
          <PageHeader
            title="Notifications"
            backPath="/home"
            tabs={headerTabs}
            activeTab="all"
          />
        </div>

        <div className={styles.list}>
          <NotificationRowsSkeleton />
        </div>
      </div>
    </main>
  );
}
