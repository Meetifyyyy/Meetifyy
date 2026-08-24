import { useEffect, useId, useRef } from 'react';
import { overlayManager } from '@shared/services/OverlayManager';

/**
 * Make an overlay dismissable with browser/hardware Back.
 *
 * Opening registers with the OverlayManager, which pushes a history entry;
 * Back then pops that entry and closes the overlay while the route underneath
 * is untouched. Only once no overlay is registered does Back navigate the page
 * as normal.
 *
 * `pushHistoryState` used to default to FALSE here, which quietly inverted the
 * whole design. With no entry pushed there was nothing for Back to pop, so the
 * browser navigated away from the page; the manager then noticed the URL had
 * changed underneath it and tore the overlay down after the fact. The overlay
 * did visibly close, which is why this read as working — but the route had
 * already changed, so Back always cost the user their page as well as their
 * modal. That is the Create Campus Community bug (Back closed the modal *and*
 * left the Campus page) and it applied to every consumer, since none of them
 * passed the option. It now defaults to true: pushing the entry is the entire
 * mechanism, not an optimisation.
 *
 * Multi-step flows pass `onBack`. It runs before `onClose` and returns true to
 * mean "I stepped back a page and I am still open" — the manager then re-pushes
 * the entry so the *next* Back is intercepted too. Return false/undefined (or
 * omit the option) and the overlay simply closes, which is what a single-step
 * overlay wants.
 *
 * @param {boolean} isOpen - Whether the overlay is currently visible
 * @param {Function} onClose - Dismiss the overlay. Must do the same cleanup as
 *   the overlay's own close button, so Back and the X are indistinguishable.
 * @param {Object} [options]
 * @param {Function} [options.onBack] - Multi-step handler; see above.
 * @param {boolean} [options.pushHistoryState=true] - Escape hatch for an
 *   overlay that genuinely must not be backable. Prefer leaving it alone.
 */
export function useOverlayBack(isOpen, onClose, options = {}) {
  const overlayId = useId();
  const onCloseRef = useRef(onClose);
  const onBackRef = useRef(options.onBack);
  const pushHistoryState = options.pushHistoryState ?? true;

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    onBackRef.current = options.onBack;
  }, [options.onBack]);

  useEffect(() => {
    if (!isOpen) return undefined;

    // Returning true keeps the overlay registered — see OverlayManager.
    //
    // `viaBack` distinguishes a Back press from a programmatic close. Only
    // Back steps: an X button, an Escape or a backdrop tap on a multi-step
    // flow means "I am done with this whole thing", and stepping it back one
    // page instead would make the close button refuse to close.
    const handleClose = (viaBack) => {
      const stepBack = onBackRef.current;
      if (viaBack && typeof stepBack === 'function' && stepBack() === true) return true;
      if (typeof onCloseRef.current === 'function') onCloseRef.current();
      return false;
    };

    const cleanup = overlayManager.open(overlayId, handleClose, { pushHistoryState });

    return () => {
      cleanup();
    };
  }, [isOpen, overlayId, pushHistoryState]);
}
