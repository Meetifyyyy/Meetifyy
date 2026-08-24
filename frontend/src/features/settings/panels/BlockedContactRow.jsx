import Avatar from '@shared/components/avatar/Avatar';
import styles from './BlockedContacts.module.css';

/**
 * Renders "Blocked on Aug 12, 2025" from the API's ISO `blockedAt`.
 * Falls back to nothing rather than printing an Invalid Date.
 */
function formatBlockedOn(blockedAt) {
  if (!blockedAt) return null;
  const date = new Date(blockedAt);
  if (Number.isNaN(date.getTime())) return null;
  return `Blocked on ${date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })}`;
}

/**
 * One row of the blocked list.
 *
 * A soft-deleted account keeps its row — the user must still be able to clear
 * the entry — but is shown anonymously rather than leaking the name of an
 * account that no longer exists.
 */
export default function BlockedContactRow({ contact, onUnblock, isRemoving }) {
  const blockedOn = formatBlockedOn(contact.blockedAt);
  const displayName = contact.isDeleted ? 'Deleted Account' : contact.displayName;

  return (
    <div className={`${styles.row} ${isRemoving ? styles.rowRemoving : ''}`}>
      <Avatar
        src={contact.isDeleted ? null : contact.avatar}
        name={displayName}
        size="44px"
      />

      <div className={styles.rowText}>
        <span className={styles.rowName}>{displayName}</span>
        <span className={styles.rowHandle}>
          {contact.isDeleted ? '—' : `@${contact.username}`}
        </span>
        {blockedOn && <span className={styles.rowDate}>{blockedOn}</span>}
      </div>

      <button
        type="button"
        className={styles.unblockBtn}
        onClick={() => onUnblock(contact)}
        disabled={isRemoving}
      >
        Unblock
      </button>
    </div>
  );
}
