import styles from './CampusEvents.module.css';

/** Poster-shaped shimmer placeholder used while a section loads. */
export default function CampusEventSkeleton() {
  return (
    <article className={styles.card} aria-hidden="true" style={{ cursor: 'default' }}>
      <div className={styles.posterWrap} style={{ background: 'var(--color-bg-soft, #eee)' }} />
      <div className={styles.cardBody}>
        <div style={{ height: 16, width: '75%', borderRadius: 6, background: 'var(--color-bg-soft, #eee)' }} />
        <div style={{ height: 12, width: '50%', borderRadius: 6, background: 'var(--color-bg-soft, #eee)', marginTop: 8 }} />
        <div style={{ height: 12, width: '40%', borderRadius: 6, background: 'var(--color-bg-soft, #eee)', marginTop: 6 }} />
        <div style={{ height: 34, width: '100%', borderRadius: 10, background: 'var(--color-bg-soft, #eee)', marginTop: 14 }} />
      </div>
    </article>
  );
}
