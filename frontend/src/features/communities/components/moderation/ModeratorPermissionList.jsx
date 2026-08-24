import styles from './ModeratorPermissionList.module.css';

/**
 * The moderator permission list, rendered identically wherever it appears.
 *
 * One component for both the owner's confirmation modal and the new
 * moderator's welcome modal, because they are showing the same promise and it
 * should read the same in both places — the owner should recognise exactly
 * what the person they promoted was told.
 *
 * Every entry's `limit` is rendered, not tucked away. "Remove members" without
 * "not the owner, and not other moderators" reads as a far larger power than
 * it is, and those limits are genuinely enforced.
 */
export default function ModeratorPermissionList({ permissions, isLoading, isError }) {
  if (isLoading) {
    return <p className={styles.state}>Loading permissions…</p>;
  }

  if (isError || !permissions?.length) {
    // Deliberately does not fall back to a hardcoded list. A stale list shown
    // as if it were current is worse than admitting we could not load it —
    // this is the moment someone decides whether to hand over the power.
    return (
      <p className={styles.state}>
        Couldn&apos;t load the permission list. Please try again before continuing.
      </p>
    );
  }

  return (
    <ul className={styles.list}>
      {permissions.map((p) => (
        <li key={p.id} className={styles.item}>
          <span className={styles.check} aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </span>
          <span className={styles.body}>
            <span className={styles.label}>{p.label}</span>
            <span className={styles.description}>{p.description}</span>
            {p.limit && <span className={styles.limit}>{p.limit}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
