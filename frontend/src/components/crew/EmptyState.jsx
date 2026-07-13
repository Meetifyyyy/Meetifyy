import styles from './EmptyState.module.css';

export default function EmptyState({ hasFilters }) {
  return (
    <div className={styles.empty}>
      <div className={styles.graphic}>
        <svg width="72" height="72" viewBox="0 0 72 72" fill="none">
          <circle cx="36" cy="36" r="28" stroke="var(--color-border)" strokeWidth="1.5" />
          <circle cx="36" cy="36" r="16" stroke="var(--color-border)" strokeWidth="1.5" strokeDasharray="3 3" />
          <circle cx="36" cy="36" r="4" fill="var(--color-border)" />
          <path d="M36 8v4M36 60v4M8 36h4M60 36h4" stroke="var(--color-border)" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M16.69 16.69l2.83 2.83M52.48 52.48l2.83 2.83M16.69 55.31l2.83-2.83M52.48 19.52l2.83-2.83" stroke="var(--color-border)" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>
      <h3 className={styles.title}>No crews found</h3>
      {hasFilters ? (
        <>
          <p className={styles.desc}>No results match your current filters. Try expanding your search.</p>
          <div className={styles.suggestions}>
            <span className={styles.suggestion}>Expand distance</span>
            <span className={styles.suggestion}>Include nearby colleges</span>
            <span className={styles.suggestion}>Try a different category</span>
          </div>
        </>
      ) : (
        <p className={styles.desc}>No crews are available right now. Check back later or explore a different category.</p>
      )}
    </div>
  );
}
