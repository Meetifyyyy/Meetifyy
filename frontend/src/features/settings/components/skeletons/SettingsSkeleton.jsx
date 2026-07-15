import Skeleton from '@shared/components/skeletons/Skeleton';
import styles from '../../pages/SettingsRoute.module.css';

/**
 * Mirrors SettingsRoute layout:
 * - Top bar with back button + title
 * - Section labels + grouped settings rows
 */
export default function SettingsSkeleton() {
  return (
    <main className="centre animate-in">
      <div className={styles.page}>
        {/* Top bar */}
        <header className={styles.topBar}>
          <Skeleton type="rect" width="36px" height="36px" style={{ borderRadius: '10px' }} />
          <Skeleton type="text" width="80px" height="16px" style={{ marginBottom: 0 }} />
          <div style={{ width: 44 }} />
        </header>

        {/* Body */}
        <div className={styles.body}>
          {/* Account section */}
          <Skeleton type="text" width="70px" height="11px" style={{ marginBottom: '0.5rem' }} />
          <div className={styles.group}>
            {[0, 1].map(i => (
              <div key={i}>
                <div className={styles.row} style={{ pointerEvents: 'none' }}>
                  <span className={styles.rowIcon}>
                    <Skeleton type="rect" width="20px" height="20px" style={{ borderRadius: '4px' }} />
                  </span>
                  <Skeleton type="text" width="130px" height="14px" style={{ marginBottom: 0 }} />
                </div>
                {i === 0 && <div className={styles.divider} />}
              </div>
            ))}
          </div>

          {/* Privacy section */}
          <Skeleton type="text" width="90px" height="11px" style={{ marginBottom: '0.5rem', marginTop: '1.25rem' }} />
          <div className={styles.group}>
            {[0, 1].map(i => (
              <div key={i}>
                <div className={styles.row} style={{ pointerEvents: 'none' }}>
                  <span className={styles.rowIcon}>
                    <Skeleton type="rect" width="20px" height="20px" style={{ borderRadius: '4px' }} />
                  </span>
                  <Skeleton type="text" width="160px" height="14px" style={{ marginBottom: 0 }} />
                </div>
                {i === 0 && <div className={styles.divider} />}
              </div>
            ))}
          </div>

          {/* Sign out button placeholder */}
          <Skeleton type="rect" width="100%" height="44px" style={{ borderRadius: 'var(--radius-md)', marginTop: '2rem' }} />
        </div>
      </div>
    </main>
  );
}
