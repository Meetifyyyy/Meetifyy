import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useOverlayBack } from '@shared/hooks/useOverlayBack';
import { useScrollLock } from '@shared/hooks/useScrollLock';
import { useSheetDrag } from '@shared/hooks/useSheetDrag';
import { CONFESSION_REACTIONS } from '@shared/lib/confessionReactions';
import RollingCount from './RollingCount';
import styles from './ReactionCountsModal.module.css';

/** The exit animation's length; matches `.leaving` in the stylesheet. */
const LEAVE_MS = 200;

/**
 * How a confession's reactions add up: every kind with its count, most first,
 * read left to right. Counts only, never who reacted.
 *
 * `state` is the confession's reaction state (reactionStateOf), so the numbers
 * follow the card live, the caller's own change included. The ORDER is taken
 * once, when the modal opens: a count changing while it is open (yours, or
 * someone else's arriving live) never moves a tile under the finger.
 *
 * Each tile is also a way to react: `onChoose(key)` with the tapped kind,
 * which the caller treats as the picker does (your own again takes it back).
 * Closing, by any route but a drag, plays the way out before `onClose`. A
 * choice is applied as that ends, not when tapped: the card then changes in
 * view (an emoji easing out, the total rolling) rather than behind the fading
 * backdrop, where it would only ever be seen to have snapped.
 */
export default function ReactionCountsModal({ open, state, onClose, onChoose }) {
  const titleId = useId();
  const closeRef = useRef(null);
  const [leaving, setLeaving] = useState(false);
  const [order, setOrder] = useState(null);

  // Taken as it opens, dropped as it closes.
  if (open && !order) {
    setOrder([...CONFESSION_REACTIONS].sort((a, b) => state.reactions[b.key] - state.reactions[a.key]));
  } else if (!open && order) {
    setOrder(null);
    setLeaving(false);
  }

  const chosen = useRef(null);
  // Latest callbacks, so a live update re-rendering the parent while this
  // closes cannot restart the timer.
  const done = useRef({ onClose, onChoose });
  useEffect(() => {
    done.current = { onClose, onChoose };
  });
  const leave = useCallback(() => setLeaving(true), []);
  useEffect(() => {
    if (!leaving) return undefined;
    const t = setTimeout(() => {
      const key = chosen.current;
      chosen.current = null;
      if (key) done.current.onChoose?.(key);
      done.current.onClose();
    }, LEAVE_MS);
    return () => clearTimeout(t);
  }, [leaving]);

  useOverlayBack(open, leave);
  useScrollLock(open);
  // A drag already carried the sheet off screen: close at once.
  const sheetRef = useSheetDrag(onClose, { enabled: open && !leaving });

  useEffect(() => {
    if (!open) return undefined;
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (e) => {
      if (e.key === 'Escape') leave();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, leave]);

  if (!open || !order) return null;

  const noun = state.reactionCount === 1 ? 'reaction' : 'reactions';

  return createPortal(
    <div
      className={`${styles.overlay} ${leaving ? styles.leaving : ''}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) leave();
      }}
    >
      <div ref={sheetRef} className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="sheet-handle" data-sheet-handle aria-hidden="true" />
        <div className={styles.head}>
          <h2 id={titleId} className={styles.title}>Reactions</h2>
          <span className={styles.total}>
            <RollingCount value={state.reactionCount} /> {noun}
          </span>
          <button ref={closeRef} type="button" className={styles.close} onClick={leave} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <ol className={styles.row}>
          {order.map((r) => {
            const n = state.reactions[r.key];
            return (
              <li key={r.key} className={styles.cell}>
                <button
                  type="button"
                  className={styles.item}
                  data-empty={n === 0 ? '' : undefined}
                  aria-pressed={state.myReaction === r.key}
                  aria-label={`${r.label}, ${n}. ${state.myReaction === r.key ? 'Remove your reaction' : 'React with this'}`}
                  disabled={leaving}
                  onClick={() => {
                    chosen.current = r.key;
                    leave();
                  }}
                >
                  <span className={styles.emoji} aria-hidden="true">{r.emoji}</span>
                  <span className={styles.count} aria-hidden="true"><RollingCount value={n} /></span>
                  <span className={styles.label} aria-hidden="true">{r.label}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </div>,
    document.body,
  );
}
