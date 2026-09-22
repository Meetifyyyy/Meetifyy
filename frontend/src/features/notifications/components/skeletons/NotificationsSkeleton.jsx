import PageHeader from '@layout/PageHeader';
import styles from '../../pages/NotificationsRoute.module.css';

export default function NotificationsSkeleton() {
  const headerTabs = [
    { id: 'all', label: 'All Notifications' },
    { id: 'invitations', label: 'Invitations' }
  ];

  return (
    <main className="centre centre-wide animate-in">
      <div className={styles.page}>
        <PageHeader
          title="Notifications"
          backPath="/home"
          tabs={headerTabs}
          activeTab="all"
        />

        <div className={styles.list}>
          <div className={styles.loadingState} role="status" aria-live="polite">
            <div className="spinner" aria-label="Loading notifications" />
          </div>
        </div>
      </div>
    </main>
  );
}
