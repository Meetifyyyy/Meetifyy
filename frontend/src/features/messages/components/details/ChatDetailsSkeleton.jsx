import Skeleton from '@shared/components/Skeleton';
import styles from './ChatDetailsPanel.module.css';

export default function ChatDetailsSkeleton({ onBack }) {
  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={onBack} title="Back">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
        </button>
        <Skeleton type="text" width="120px" height="1.2rem" style={{ margin: 0 }} />
      </div>

      <div className={styles.content}>
        {/* Profile Hero Section */}
        <div className={styles.profileSection}>
          <div className={styles.avatarWrapper}>
            <Skeleton type="circle" width="88px" height="88px" />
          </div>
          <Skeleton type="text" width="160px" height="1.4rem" style={{ marginTop: '0.75rem', marginBottom: '0.25rem' }} />
          <Skeleton type="text" width="100px" height="0.9rem" />
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: '1rem', padding: '1rem', justifyContent: 'center' }}>
          <Skeleton type="rect" width="120px" height="38px" style={{ borderRadius: '100px' }} />
          <Skeleton type="rect" width="120px" height="38px" style={{ borderRadius: '100px' }} />
        </div>

        {/* Members List Skeleton */}
        <div className={styles.sectionCard} style={{ marginTop: '1rem' }}>
          <div style={{ padding: '1rem', borderBottom: '1px solid var(--color-border-light)' }}>
            <Skeleton type="text" width="90px" height="1rem" style={{ margin: 0 }} />
          </div>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '0.75rem 1rem' }}>
              <Skeleton type="circle" width="40px" height="40px" />
              <div style={{ flex: 1 }}>
                <Skeleton type="text" width="45%" height="0.95rem" style={{ marginBottom: '4px' }} />
                <Skeleton type="text" width="25%" height="0.8rem" style={{ margin: 0 }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
