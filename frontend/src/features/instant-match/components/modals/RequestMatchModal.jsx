import { useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useOverlayBack } from '@shared/hooks/useOverlayBack';
import { useScrollLock } from '@shared/hooks/useScrollLock';
import { getActivityVerb } from '../../constants/matchConstants';
import Face from '../art/Face';
import { MatchMark } from '../decor/Decor';
import '../../styles/instant-match.css';
import '../../styles/instant-match-chat.css';

/**
 * Confirmation before asking one person on the roster to match.
 *
 * A request interrupts a stranger's search with a card they have to answer,
 * so it never goes on the first tap. The dialog names them by handle, says
 * what they are up for, and says what happens to this user's own search.
 */
export default function RequestMatchModal({ person, busy, onCancel, onConfirm }) {
  useOverlayBack(true, onCancel);
  useScrollLock(true);

  const ref = useRef(null);
  useFocusTrap(ref, true, busy ? undefined : onCancel);

  const cancelRef = useRef(null);
  useEffect(() => { cancelRef.current?.focus(); }, []);

  const name = person.user.displayName || person.user.username || 'this student';
  const handle = person.user.username ? `@${person.user.username}` : name;

  return createPortal(
    <div
      className="im-scope im-leave-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}
    >
      <div
        className="im-leave-card im-request-card"
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="im-request-title"
      >
        <span className="im-request-face">
          <Face avatar={person.user.avatar} name={name} size={64} />
          <span className="im-request-mark" aria-hidden="true"><MatchMark /></span>
        </span>
        <h2 id="im-request-title" className="im-title im-leave-title">
          Send a match request to {handle}?
        </h2>
        <p className="im-lede im-leave-body">
          They want to {getActivityVerb(person.activity)}. If they accept, you&apos;re
          matched. If not, your search carries on.
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
            className="im-btn im-btn-primary"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Sending…' : 'Send request'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
