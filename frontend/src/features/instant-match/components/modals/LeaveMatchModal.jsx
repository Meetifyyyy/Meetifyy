import React, { useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import '../../styles/instant-match.css';
import '../../styles/instant-match-chat.css';
import { useOverlayBack } from '@shared/hooks/useOverlayBack';
import { useScrollLock } from '@shared/hooks/useScrollLock';

/**
 * Confirmation before walking away from a match.
 *
 * "Find someone new" is destructive and irreversible — it ends the chat for
 * both people, permanently, with no way back to it. So it never fires on the
 * first tap. The wording names the other person and states both consequences
 * plainly rather than asking "are you sure?", which tells the user nothing
 * about what they are about to lose.
 */
export default function LeaveMatchModal({ partnerName, busy, onCancel, onConfirm }) {
  // Back dismisses this dialog rather than navigating the page behind it.
  useOverlayBack(true, onCancel);
  // Background stays put while this dialog is open. Counted, so a
  // dialog opened on top of another cannot unlock the page when it closes.
  useScrollLock(true);

  const ref = useRef(null);
  useFocusTrap(ref, true, busy ? undefined : onCancel);

  // Cancel is the safe default, so it takes focus rather than the
  // destructive action — a stray Enter must not end someone's match.
  const cancelRef = useRef(null);
  useEffect(() => { cancelRef.current?.focus(); }, []);

  return createPortal(
    <div
      className="im-scope im-leave-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}
    >
      <div className="im-leave-card" ref={ref} role="alertdialog" aria-modal="true" aria-labelledby="im-leave-title">
        <h2 id="im-leave-title" className="im-display im-display-lg im-leave-title">
          Leave this match?
        </h2>
        <p className="im-lede im-leave-body">
          You and <strong>{partnerName}</strong> will no longer be connected, and this
          Instant Match chat will end for both of you.
        </p>

        <div className="im-leave-actions">
          <button
            type="button"
            className="im-btn im-btn-ghost"
            onClick={onCancel}
            disabled={busy}
            ref={cancelRef}
          >
            Cancel
          </button>
          <button
            type="button"
            className="im-btn im-btn-danger"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Leaving…' : 'Leave & find someone new'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
