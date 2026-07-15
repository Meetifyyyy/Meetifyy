import Skeleton from '@shared/components/skeletons/Skeleton';
import styles from '../../pages/NotificationsRoute.module.css';

function NotifRowSkeleton() {
  return (
    <div className={styles.item} style={{ pointerEvents: 'none', background: 'var(--color-bg-white)' }}>
      <div className={styles.avatar} style={{ background: 'transparent' }}>
        <Skeleton type="circle" width="40px" height="40px" />
      </div>
      <div className={styles.content} style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <Skeleton type="text" width="60%" height="1.1rem" style={{ marginBottom: '0.4rem' }} />
        <Skeleton type="text" width="40%" height="0.8rem" />
      </div>
      <div className={styles.actionSlot}>
        <Skeleton type="rect" width="70px" height="32px" style={{ borderRadius: '100px' }} />
      </div>
    </div>
  );
}

/**
 * Mirrors NotificationsRoute layout:
 * - PageHeader with title + tabs
 * - Grouped notification rows
 */
export default function NotificationsSkeleton() {
  return (
    <main className="centre centre-wide animate-in">
      <div className={styles.page}>
        {/* Header skeleton */}
        <div style={{
          background: 'var(--color-bg-white)',
          border: '1px solid var(--color-border-light)',
          borderRadius: 'var(--radius-lg)',
          padding: '1.25rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
          marginBottom: '0.5rem',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <Skeleton type="text" width="160px" height="20px" style={{ marginBottom: 0 }} />
            <Skeleton type="text" width="260px" height="12px" style={{ marginBottom: 0 }} />
          </div>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--color-border-light)', paddingBottom: '0.75rem' }}>
            <Skeleton type="rect" width="130px" height="30px" style={{ borderRadius: '4px' }} />
            <Skeleton type="rect" width="100px" height="30px" style={{ borderRadius: '4px' }} />
          </div>
        </div>

        {/* Group label */}
        <div style={{ padding: '0.5rem 0' }}>
          <Skeleton type="text" width="60px" height="12px" style={{ marginBottom: '0.5rem' }} />
        </div>

        {/* Notification rows */}
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
