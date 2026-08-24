import { useEffect, useRef } from 'react';
import styles from './BlockedContacts.module.css';

/**
 * Confirmation shown before any unblock request is sent.
 *
 * Unblocking is not destructive, but it is invisible once done — there is no
 * success toast (a bystander could read it), so the confirmation is the only
 * moment the user is told what is about to change. Hence the explicit body copy.
 */
export default function UnblockConfirmDialog({ contact, onConfirm, onCancel, isSubmitting }) {
  const confirmRef = useRef(null);

  // Focus the confirm action on open, and let Escape cancel — the dialog traps
  // the interaction, so it must be dismissible from the keyboard.
  useEffect(() => {
    confirmRef.current?.focus();
    const onKeyDown = (e) => {
      if (e.key === 'Escape' && !isSubmitting) onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel, isSubmitting]);

  if (!contact) return null;

  const name = contact.isDeleted ? 'Deleted Account' : contact.displayName;

  return (
    <div
      className={styles.dialogBackdrop}
      onClick={() => { if (!isSubmitting) onCancel(); }}
    >
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="unblock-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="unblock-dialog-title" className={styles.dialogTitle}>
          Unblock {name}?
        </h2>
        <p className={styles.dialogBody}>
          They will be able to see your profile and content again.
        </p>
        <div className={styles.dialogActions}>
          <button
            type="button"
            className={styles.dialogCancel}
            onClick={onCancel}
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            type="button"
            ref={confirmRef}
            className={styles.dialogConfirm}
            onClick={onConfirm}
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Unblocking…' : 'Unblock'}
          </button>
        </div>
      </div>
    </div>
  );
}
