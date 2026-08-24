import { createPortal } from 'react-dom';
import { useOverlayBack } from '@shared/hooks/useOverlayBack';
import { useScrollLock } from '@shared/hooks/useScrollLock';
import ModeratorPermissionList from './ModeratorPermissionList';
import styles from './PromotionModals.module.css';

/**
 * Shown once to a newly promoted moderator, the next time they open the
 * community.
 *
 * The permission list comes with the notice from the server rather than being
 * fetched separately, so it is the same list the owner confirmed against and
 * arrives with the page rather than popping in a moment later.
 *
 * Every dismissal path acknowledges. There is nothing to decide here — it is
 * information — so treating a backdrop tap or a Back press as "not seen" would
 * only bring it back on the next visit, which is exactly the pestering the
 * once-per-promotion rule exists to prevent.
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
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            <polyline points="9 12 11 14 15 10" />
          </svg>
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
