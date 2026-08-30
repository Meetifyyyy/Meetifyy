import { useParams } from 'react-router-dom';
import Skeleton from '@shared/components/skeletons/Skeleton';
import styles from './SettingsSkeleton.module.css';

/**
 * SettingsSkeleton
 *
 * Minimal, clean, and responsive skeleton loading screen for Settings.
 * - Large screens (>=1024px): Renders the two-pane split layout (nav list + detail content).
 * - Small screens (<1024px): Renders contextual single pane (list view on /settings, detail view on /settings/:panel).
 * - Avoids cluttered micro-placeholders and ensures zero layout shift on content mount.
 */
export default function SettingsSkeleton() {
  const { panel } = useParams();
  const hasActivePanel = Boolean(panel);

  return (
    <main className="centre centre-wide centre--sheet animate-in">
      <div className={styles.page}>
        {/* Top Header Bar */}
        <header className={styles.topBar}>
          <Skeleton 
            type="rect" 
            width="36px" 
            height="36px" 
            style={{ borderRadius: '50%' }} 
          />
          <Skeleton 
            type="rect" 
            width="110px" 
            height="18px" 
            style={{ borderRadius: '6px' }} 
          />
          <div style={{ width: 36 }} />
        </header>

        {/* Responsive Body Container */}
        <div className={styles.splitBody}>
          {/* Left Navigation List Pane */}
          <div className={`${styles.listPane} ${hasActivePanel ? styles.hideMobileList : ''}`}>
            <div className={styles.bodyContent}>
              {/* Account Section */}
              <div className={styles.sectionLabelWrap}>
                <Skeleton type="rect" width="72px" height="10px" style={{ borderRadius: '4px' }} />
              </div>
              <div className={styles.cardGroup}>
                <div className={styles.rowItem}>
                  <Skeleton type="rect" width="36px" height="36px" style={{ borderRadius: '10px' }} />
                  <Skeleton type="rect" width="120px" height="14px" style={{ borderRadius: '4px' }} />
                </div>
                <div className={styles.rowDivider} />
                <div className={styles.rowItem}>
                  <Skeleton type="rect" width="36px" height="36px" style={{ borderRadius: '10px' }} />
                  <Skeleton type="rect" width="140px" height="14px" style={{ borderRadius: '4px' }} />
                </div>
                <div className={styles.rowDivider} />
                <div className={styles.rowItem}>
                  <Skeleton type="rect" width="36px" height="36px" style={{ borderRadius: '10px' }} />
                  <Skeleton type="rect" width="150px" height="14px" style={{ borderRadius: '4px' }} />
                </div>
              </div>

              {/* Preferences Section */}
              <div className={styles.sectionLabelWrap}>
                <Skeleton type="rect" width="88px" height="10px" style={{ borderRadius: '4px' }} />
              </div>
              <div className={styles.cardGroup}>
                <div className={styles.rowItem}>
                  <Skeleton type="rect" width="36px" height="36px" style={{ borderRadius: '10px' }} />
                  <Skeleton type="rect" width="130px" height="14px" style={{ borderRadius: '4px' }} />
                </div>
                <div className={styles.rowDivider} />
                <div className={styles.rowItem}>
                  <Skeleton type="rect" width="36px" height="36px" style={{ borderRadius: '10px' }} />
                  <Skeleton type="rect" width="110px" height="14px" style={{ borderRadius: '4px' }} />
                </div>
              </div>

              {/* More Section */}
              <div className={styles.sectionLabelWrap}>
                <Skeleton type="rect" width="54px" height="10px" style={{ borderRadius: '4px' }} />
              </div>
              <div className={styles.cardGroup}>
                <div className={styles.rowItem}>
                  <Skeleton type="rect" width="36px" height="36px" style={{ borderRadius: '10px' }} />
                  <Skeleton type="rect" width="125px" height="14px" style={{ borderRadius: '4px' }} />
                </div>
                <div className={styles.rowDivider} />
                <div className={styles.rowItem}>
                  <Skeleton type="rect" width="36px" height="36px" style={{ borderRadius: '10px' }} />
                  <Skeleton type="rect" width="145px" height="14px" style={{ borderRadius: '4px' }} />
                </div>
              </div>
            </div>
          </div>

          {/* Right Detail Pane */}
          <div className={`${styles.detailPane} ${!hasActivePanel ? styles.hideMobileDetail : ''}`}>
            <div className={styles.bodyContent}>
              {/* Detail Header Silhouette */}
              <div className={styles.detailHeaderBlock}>
                <Skeleton type="circle" width="60px" height="60px" />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
                  <Skeleton type="rect" width="140px" height="16px" style={{ borderRadius: '4px' }} />
                  <Skeleton type="rect" width="200px" height="12px" style={{ borderRadius: '4px' }} />
                </div>
              </div>

              {/* Primary Content Group Block */}
              <div className={styles.cardGroup}>
                <div className={styles.detailFieldBlock}>
                  <Skeleton type="rect" width="90px" height="11px" style={{ borderRadius: '3px' }} />
                  <Skeleton type="rect" width="100%" height="24px" style={{ borderRadius: '4px' }} />
                </div>
                <div className={styles.fieldDivider} />
                <div className={styles.detailFieldBlock}>
                  <Skeleton type="rect" width="75px" height="11px" style={{ borderRadius: '3px' }} />
                  <Skeleton type="rect" width="100%" height="24px" style={{ borderRadius: '4px' }} />
                </div>
                <div className={styles.fieldDivider} />
                <div className={styles.detailFieldBlock}>
                  <Skeleton type="rect" width="110px" height="11px" style={{ borderRadius: '3px' }} />
                  <Skeleton type="rect" width="100%" height="24px" style={{ borderRadius: '4px' }} />
                </div>
              </div>

              {/* Secondary Content Group Block */}
              <div className={styles.cardGroup}>
                <div className={styles.detailFieldBlock}>
                  <Skeleton type="rect" width="100px" height="11px" style={{ borderRadius: '3px' }} />
                  <Skeleton type="rect" width="100%" height="48px" style={{ borderRadius: '8px' }} />
                </div>
              </div>

              {/* Action Button Placeholder */}
              <div className={styles.actionBtnWrap}>
                <Skeleton 
                  type="rect" 
                  width="100%" 
                  height="42px" 
                  style={{ borderRadius: '9999px' }} 
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
