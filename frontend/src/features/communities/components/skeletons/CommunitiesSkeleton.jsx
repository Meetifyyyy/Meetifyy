import Skeleton from '@shared/components/skeletons/Skeleton';
import CommunityCardSkeleton from '../card/CommunityCardSkeleton';
import CommunityGrid from '../card/CommunityGrid';
import styles from '../browse/CommunitiesBrowse.module.css';

/**
 * Mirrors CommunitiesRoute (CommunitiesBrowse) layout:
 * - PageHeader with search + category pill tabs
 * - Grid of community card skeletons
 */
export default function CommunitiesSkeleton() {
  return (
    <main className="centre centre-wide animate-in">
      <div>
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
              <Skeleton type="text" width="130px" height="20px" style={{ marginBottom: 0 }} />
              <Skeleton type="text" width="180px" height="12px" style={{ marginBottom: 0 }} />
            </div>
            <Skeleton type="rect" width="36px" height="36px" style={{ borderRadius: '10px' }} />
          </div>
          {/* Search */}
          <Skeleton type="rect" width="100%" height="38px" style={{ borderRadius: '20px' }} />
          {/* Category pills */}
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {[80, 100, 70, 90, 75, 95, 65].map((w, i) => (
              <Skeleton key={i} type="rect" width={`${w}px`} height="30px" style={{ borderRadius: '100px' }} />
            ))}
          </div>
        </div>

        {/* Grid */}
        <div className={styles.content}>
          <section className={styles.gridSection}>
            <CommunityGrid>
              <CommunityCardSkeleton />
              <CommunityCardSkeleton />
              <CommunityCardSkeleton />
              <CommunityCardSkeleton />
              <CommunityCardSkeleton />
              <CommunityCardSkeleton />
            </CommunityGrid>
          </section>
        </div>
      </div>
    </main>
  );
}
