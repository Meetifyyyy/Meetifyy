import Skeleton from '@shared/components/skeletons/Skeleton';
import CampusEventSkeleton from '@features/campus-events/components/CampusEventSkeleton';
import eventStyles from '@features/campus-events/components/CampusEvents.module.css';
import sharedStyles from './CampusShared.module.css';
import pageStyles from '../../pages/CampusPage.module.css';
const styles = { ...sharedStyles, ...pageStyles };

/**
 * Mirrors CampusPage layout:
 * - Header banner with title + nav tabs
 * - Activities section with 2 crew card placeholders
 * - Side-by-side: "you may know" person circles + "discover groups" card
 */
export default function CampusSkeleton() {
  return (
    <main className={`centre centre-wide ${styles.hubContainer}`}>
      {/* Header banner */}
      <div className={styles.headerBanner}>
        <header className={styles.header}>
          <Skeleton type="text" width="200px" height="28px" style={{ marginBottom: 0 }} />
          <Skeleton type="rect" width="36px" height="36px" style={{ borderRadius: '10px' }} />
        </header>
        {/* Nav tabs */}
        <div className={styles.stickyNav}>
          {['Events', 'Directory', 'Communities'].map(tab => (
            <Skeleton
              key={tab}
              type="rect"
              width="90px"
              height="36px"
              style={{ borderRadius: '20px' }}
            />
          ))}
        </div>
      </div>

      <div className={styles.campusBody}>
        {/* Campus Events section */}
        <section className={styles.section}>
          <div className={styles.sectionHeaderRow}>
            <Skeleton type="rect" width="24px" height="24px" style={{ borderRadius: '6px' }} />
            <Skeleton type="text" width="150px" height="16px" style={{ marginBottom: 0 }} />
          </div>
          {/* Event poster card placeholders */}
          <div className={eventStyles.grid}>
            <CampusEventSkeleton />
            <CampusEventSkeleton />
          </div>
        </section>

        {/* Campus Activities section */}
        <section className={styles.section}>
          <div className={styles.sectionHeaderRow}>
            <Skeleton type="rect" width="24px" height="24px" style={{ borderRadius: '6px' }} />
            <Skeleton type="text" width="160px" height="16px" style={{ marginBottom: 0 }} />
          </div>
          <Skeleton type="rect" width="100%" height="80px" style={{ borderRadius: '14px' }} />
          <Skeleton type="rect" width="100%" height="80px" style={{ borderRadius: '14px', marginTop: '8px' }} />
        </section>

        {/* Side by side: You may know & Discover groups */}
        <div className={styles.sideBySideDesktop}>
          {/* You may know */}
          <section className={styles.section}>
            <div className={styles.sectionHeaderRow}>
              <Skeleton type="rect" width="24px" height="24px" style={{ borderRadius: '6px' }} />
              <Skeleton type="text" width="110px" height="16px" style={{ marginBottom: 0 }} />
            </div>
            <div className={styles.knowListContainer}>
              {[0, 1, 2, 3].map(i => (
                <div key={i} className={styles.knowCard}>
                  <Skeleton type="circle" width="88px" height="88px" />
                  <Skeleton type="text" width="70px" height="11px" style={{ marginBottom: 0, marginTop: '4px' }} />
                </div>
              ))}
            </div>
          </section>

          {/* Discover groups */}
          <section className={styles.section}>
            <div className={styles.sectionHeaderRow}>
              <Skeleton type="rect" width="24px" height="24px" style={{ borderRadius: '6px' }} />
              <Skeleton type="text" width="130px" height="16px" style={{ marginBottom: 0 }} />
            </div>
            <Skeleton type="rect" width="100%" height="80px" style={{ borderRadius: 'var(--radius-md)' }} />
          </section>
        </div>
      </div>
    </main>
  );
}
