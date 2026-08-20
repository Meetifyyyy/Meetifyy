import PageHeader from '@layout/PageHeader';
import Skeleton from '@shared/components/skeletons/Skeleton';
import styles from '../../pages/NotificationsRoute.module.css';

export function NotifRowSkeleton() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.85rem',
        padding: '0.85rem 1rem',
        borderBottom: '1px solid var(--color-border-light)',
        pointerEvents: 'none',
        background: 'var(--color-bg-white)',
        boxSizing: 'border-box'
      }}
    >
      <div style={{ width: '40px', height: '40px', borderRadius: '50%', overflow: 'hidden', flexShrink: 0 }}>
        <Skeleton type="circle" width="40px" height="40px" />
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.35rem', minWidth: 0 }}>
        <Skeleton type="text" width="55%" height="0.9rem" style={{ marginBottom: 0 }} />
        <Skeleton type="text" width="35%" height="0.75rem" style={{ marginBottom: 0 }} />
      </div>
      <div style={{ flexShrink: 0, minWidth: '70px', display: 'flex', justifyContent: 'flex-end' }}>
        <Skeleton type="rect" width="65px" height="28px" style={{ borderRadius: '100px' }} />
      </div>
    </div>
  );
}

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
          <div className={styles.groupItems}>
            <NotifRowSkeleton />
            <NotifRowSkeleton />
            <NotifRowSkeleton />
            <NotifRowSkeleton />
            <NotifRowSkeleton />
            <NotifRowSkeleton />
          </div>
        </div>
      </div>
    </main>
  );
}

