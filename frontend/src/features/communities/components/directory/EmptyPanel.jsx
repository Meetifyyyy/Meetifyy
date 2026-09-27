import styles from './CommunityList.module.css';

/** The empty state both Communities tabs use: icon, title, text, actions. */
export default function EmptyPanel({ icon, title, children, actions }) {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyIcon} aria-hidden="true">{icon}</span>
      <h3 className={styles.emptyTitle}>{title}</h3>
      <p className={styles.emptyText}>{children}</p>
      {actions && <div className={styles.emptyActions}>{actions}</div>}
    </div>
  );
}
