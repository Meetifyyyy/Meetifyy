import styles from './CommunityList.module.css';

/** The empty state both Communities tabs use: title, text, actions. */
export default function EmptyPanel({ title, children, actions }) {
  return (
    <div className={styles.empty}>
      <h3 className={styles.emptyTitle}>{title}</h3>
      <p className={styles.emptyText}>{children}</p>
      {actions && <div className={styles.emptyActions}>{actions}</div>}
    </div>
  );
}
