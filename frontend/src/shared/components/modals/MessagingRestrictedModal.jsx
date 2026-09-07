import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Lock } from '@shared/components/icons';
import { useOverlayBack } from '@shared/hooks/useOverlayBack';
import { useScrollLock } from '@shared/hooks/useScrollLock';
import {
  MESSAGING_RESTRICTED_BODY,
  MESSAGING_RESTRICTED_TITLE,
} from '@shared/lib/studentYearPolicy';
import styles from './ConfirmModal.module.css';

/**
 * "Messaging Restricted" — what a locked Message button opens.
 *
 * Built on ConfirmModal's stylesheet rather than a new one, so it inherits the
 * app's modal surface, typography, spacing, colours, animation and dark-theme
 * handling exactly. The only structural difference is that this dialog has one
 * action: it explains a state, it does not ask anything.
 *
 * It is PURELY informational. It creates no conversation, sends no message and
 * issues no request of any kind — which is the point: the locked button is a
 * dead end by construction, not a request the server happens to refuse.
 *
 * Symmetric by design. The same dialog, with the same words, is shown to a
 * first-year student looking at an older student's profile and to an older
 * student looking at a first-year's. The copy never says which side of the
 * line the person reading it is on, because that would disclose the other
 * account's cohort.
 */
export default function MessagingRestrictedModal({ visible = true, onClose }) {
  const overlayRef = useRef(null);
  const dismissRef = useRef(null);

  useOverlayBack(visible, onClose);
  // Background stays put while this dialog is open. Counted, so a dialog
  // opened on top of another cannot unlock the page when it closes.
  useScrollLock(visible);

  useEffect(() => {
    if (!visible) return;
    requestAnimationFrame(() => overlayRef.current?.classList.add(styles.open));
    // Focus moves into the dialog so a keyboard or screen-reader user lands on
    // the only thing there is to do here, and Escape/Enter both work without a
    // hunt. ConfirmModal does not do this; a single-action dialog with nothing
    // else focusable is where it matters most.
    dismissRef.current?.focus();
  }, [visible]);

  if (!visible) return null;

  const handleClose = () => {
    overlayRef.current?.classList.remove(styles.open);
    setTimeout(onClose, 250);
  };

  return createPortal(
    <div
      className={styles.confirmOverlay}
      ref={overlayRef}
      onClick={(e) => {
        if (e.target === overlayRef.current) handleClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') handleClose();
      }}
    >
      <div
        className={styles.confirmModal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="messaging-restricted-title"
        aria-describedby="messaging-restricted-desc"
      >
        <div className={`${styles.confirmIcon} ${styles.confirmIconPrimary}`}>
          {/* Decorative: the heading beside it already names the state, so a
              screen reader announcing "lock" here would only repeat it. */}
          <Lock size={24} strokeWidth={2} aria-hidden="true" />
        </div>
        <div className={styles.confirmTitle} id="messaging-restricted-title">
          {MESSAGING_RESTRICTED_TITLE}
        </div>
        <div className={styles.confirmDesc} id="messaging-restricted-desc">
          {MESSAGING_RESTRICTED_BODY}
        </div>
        <div className={styles.confirmActions}>
          <button
            ref={dismissRef}
            type="button"
            className={`${styles.confirmBtn} ${styles.confirmBtnPrimary}`}
            onClick={handleClose}
          >
            Got it
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
