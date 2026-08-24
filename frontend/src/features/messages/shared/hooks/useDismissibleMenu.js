import { useCallback, useEffect, useRef, useState } from 'react';
import { useOverlayBack } from '@shared/hooks/useOverlayBack';

/**
 * The chat header's three-dot menu, and anything shaped like it.
 *
 * A dropdown that can only be closed by picking one of its own items is a
 * trap, and that is what this menu was: the only way out was to choose an
 * action. Tapping the page behind it did nothing, and on mobile the hardware
 * Back button — the obvious escape — closed the entire chat instead, throwing
 * the user out of the conversation to dismiss a menu.
 *
 * Three ways out, which is what a menu is expected to have:
 *
 *  - a tap or click anywhere outside `anchorRef`,
 *  - Escape,
 *  - hardware/browser Back, which closes the menu and stops there.
 *
 * The Back behaviour comes from `useOverlayBack`: opening pushes a history
 * entry, so the first press pops that entry and closes the menu while the
 * chat route underneath is untouched. Only the second press — with no menu
 * entry left to pop — leaves the chat. Closing by any other route disposes
 * that entry, so the history stack never drifts.
 *
 * `touchstart` is listened for alongside `mousedown` because a tap that
 * begins a scroll gesture may never produce a `mousedown` at all, and the
 * menu would sit there through a whole scroll.
 */
export function useDismissibleMenu(initial = false) {
  const [open, setOpen] = useState(initial);
  const anchorRef = useRef(null);

  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((v) => !v), []);

  useOverlayBack(open, close);

  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (e) => {
      // The toggle button lives inside the anchor, so a click on it is never
      // "outside" — otherwise this handler would close the menu in the same
      // gesture that the button's onClick reopened it, and it would appear
      // never to open at all.
      if (anchorRef.current && anchorRef.current.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown, { passive: true });
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return { open, setOpen, toggle, close, anchorRef };
}
