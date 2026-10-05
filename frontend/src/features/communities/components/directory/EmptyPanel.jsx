import styles from './CommunityList.module.css';

/**
 * The empty state both Communities tabs use: a short title, one line, the next step.
 *
 * Kept deliberately brief - the tab's own heading already says what the tab is for,
 * so this only says why it is empty and offers the way out.
 */
export default function EmptyPanel({ title, children, actions }) {
  return (
    <div className={styles.empty}>
      {title && <h3 className={styles.emptyTitle}>{title}</h3>}
      {children && <p className={styles.emptyText}>{children}</p>}
      {actions && <div className={styles.emptyActions}>{actions}</div>}
    </div>
  );
}
