import styles from './ActionDot.module.css';

/**
 * A small dot, no number, marking an entry that has something waiting for the
 * user. The visual is decorative; the visually hidden text carries the meaning.
 */
export default function ActionDot({ className = '', label = '(action needed)' }) {
  return (
    <span className={`${styles.dot} ${className}`} data-testid="action-dot">
      <span className={styles.srOnly}>{label}</span>
    </span>
  );
}
