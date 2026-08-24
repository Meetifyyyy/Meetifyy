import { createPortal } from 'react-dom';
import { useOverlayBack } from '@shared/hooks/useOverlayBack';
import { useScrollLock } from '@shared/hooks/useScrollLock';
import { useModeratorPermissions } from '@shared/hooks/useModeratorPermissions';
import ModeratorPermissionList from './ModeratorPermissionList';
import styles from './PromotionModals.module.css';

/**
 * The owner's confirmation before handing someone moderator powers.
 *
 * Promotion used to be an instant menu action. Making someone a moderator
 * grants real authority over other people's content and membership, and it is
 * one tap away from "remove member" in the same menu — so it gets a deliberate
 * confirmation that spells out exactly what is being granted.
 *
 * Nothing happens until Confirm. Every other exit — Cancel, the backdrop,
 * Escape, hardware Back — is a cancel, which is why `onCancel` is the single
 * close handler passed to all of them.
 */
export default function PromoteModeratorModal({ memberName, isBusy, onConfirm, onCancel }) {
  const { permissions, isLoading, isError } = useModeratorPermissions();

  useScrollLock(true);
  // Back dismisses the modal without promoting — same as Cancel.
  useOverlayBack(true, onCancel);

  // The list is the entire point of this modal. Confirming while it failed to
  // load would mean approving a grant we could not describe.
  const canConfirm = !isBusy && !isLoading && !isError && permissions.length > 0;

  return createPortal(
    <div
      className={styles.overlay}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="promote-mod-title"
    >
      <div className={styles.card}>
        <h2 id="promote-mod-title" className={styles.title}>
          Make {memberName || 'this member'} a moderator?
        </h2>
        <p className={styles.lede}>They&apos;ll be able to:</p>

        <div className={styles.listWrap}>
          <ModeratorPermissionList
            permissions={permissions}
            isLoading={isLoading}
            isError={isError}
          />
        </div>

        <p className={styles.footnote}>
          You can remove moderator access at any time.
        </p>

        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={onCancel} disabled={isBusy}>
            Cancel
          </button>
          <button type="button" className={styles.primary} onClick={onConfirm} disabled={!canConfirm}>
            {isBusy ? 'Making moderator…' : 'Make moderator'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
