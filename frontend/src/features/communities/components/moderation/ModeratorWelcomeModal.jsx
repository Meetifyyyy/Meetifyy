import { createPortal } from 'react-dom';
import { useOverlayBack } from '@shared/hooks/useOverlayBack';
import { useScrollLock } from '@shared/hooks/useScrollLock';
import { Shield } from '@shared/components/icons';
import ModeratorPermissionList from './ModeratorPermissionList';
import styles from './PromotionModals.module.css';

/**
 * Shown once to a newly promoted moderator, the next time they open the
 * community.
 *
 * The permission list comes with the notice from the server rather than being
 * fetched separately, so it is the same list the owner confirmed against and
 * arrives with the page rather than popping in a moment later.
 */
export default function ModeratorWelcomeModal({ communityName, permissions, onAcknowledge }) {
  useScrollLock(true);
  useOverlayBack(true, onAcknowledge);

  return createPortal(
    <div
      className={styles.overlay}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onAcknowledge(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="mod-welcome-title"
    >
      <div className={styles.card}>
        <div className={styles.badge} aria-hidden="true">
          <Shield size={24} strokeWidth={2} />
        </div>

        <h2 id="mod-welcome-title" className={styles.title}>
          You&apos;re now a moderator{communityName ? ` of ${communityName}` : ''}
        </h2>
        <p className={styles.lede}>Here&apos;s what you can do:</p>

        <div className={styles.listWrap}>
          <ModeratorPermissionList permissions={permissions} />
        </div>

        <div className={styles.actions}>
          <button type="button" className={styles.primaryWide} onClick={onAcknowledge}>
            Got it
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
