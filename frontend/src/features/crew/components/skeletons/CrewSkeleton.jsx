import Skeleton from '@shared/components/skeletons/Skeleton';
import CrewCardSkeleton from '../cards/CrewCardSkeleton';
import styles from '../../pages/FindYourCrewPage.module.css';

/**
 * Mirrors FindYourCrewPage layout:
 * - PageHeader with title + search + tabs
 * - Left: list of crew card skeletons
 * - Right: sidebar panel placeholder
 */
export default function CrewSkeleton() {
  return (
    <>
      <main className="centre centre-wide animate-in">
        <div className={styles.page}>
          {/* PageHeader skeleton */}
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
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <Skeleton type="text" width="80px" height="20px" style={{ marginBottom: 0 }} />
                <Skeleton type="text" width="200px" height="12px" style={{ marginBottom: 0 }} />
              </div>
              <Skeleton type="rect" width="36px" height="36px" style={{ borderRadius: '10px' }} />
            </div>
            {/* Search bar */}
            <Skeleton type="rect" width="100%" height="38px" style={{ borderRadius: '20px' }} />
            {/* Tabs */}
            <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--color-border-light)', paddingBottom: '0.75rem' }}>
              {['For You', 'Popular', 'My Activities', 'Saved'].map(tab => (
                <Skeleton key={tab} type="rect" width="85px" height="30px" style={{ borderRadius: '4px' }} />
              ))}
            </div>
          </div>

          {/* Content layout */}
          <div className={styles.layout}>
            <div className={styles.content}>
              <div className={styles.list}>
                <CrewCardSkeleton />
                <CrewCardSkeleton />
                <CrewCardSkeleton />
              </div>
            </div>

            {/* Right sidebar */}
            <div className={styles.sidebarWrapper}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <Skeleton type="rect" width="100%" height="200px" style={{ borderRadius: 'var(--radius-lg)' }} />
                <Skeleton type="rect" width="100%" height="150px" style={{ borderRadius: 'var(--radius-lg)' }} />
              </div>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
