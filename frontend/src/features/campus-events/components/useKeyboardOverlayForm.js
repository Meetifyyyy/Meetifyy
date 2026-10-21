import { useEffect } from 'react';
import { KEYBOARD_OVERLAYS_PAGE } from '@shared/utils/keyboardOverlay';
import { keyboardInset } from '@shared/utils/visibleViewport';
import { scrollableAncestor } from '@shared/utils/keyboardFocus';

/**
 * A full-screen form in the installed Android app, where the keyboard overlays
 * a WebView that never resizes.
 *
 * The page keeps its size and the keyboard simply covers the bottom of it,
 * action bar included: nothing lifts, so nothing moves twice. Shrinking the
 * page by layout instead (padding the overlay by --kb-inset) moves the footer in
 * the frame the keyboard starts, and the app-wide slide for sheets
 * (keyboardSheetRise) then replays a second movement on top of it.
 *
 * The scroll area gets the keyboard's height as bottom room (the stylesheet,
 * transitioned on the keyboard's own duration and curve, so the content settles
 * down with the keyboard when it closes instead of snapping). What is left for
 * this hook is scrolling the focused field clear of the keyboard, once per
 * keyboard show and once per focus change while it is up. The app-wide helper
 * (ensureFocusedVisible) is switched off for this surface with
 * `data-keyboard-dock`, because it would scroll on top of this.
 */

/** Space kept between the field and what covers it. */
const MARGIN_PX = 12;

/**
 * How far the scroll area must scroll to bring a field above the keyboard, or 0.
 * Never past the field's own top (a tall field keeps its start visible).
 * Pure, so it can be tested without a device.
 */
export function revealOverlap({ fieldRect, bodyTop, viewportHeight, inset, margin = MARGIN_PX }) {
  const limit = viewportHeight - inset - margin;
  const overlap = Math.ceil(fieldRect.bottom - limit);
  if (overlap <= 0) return 0;
  return Math.max(0, Math.min(overlap, Math.floor(fieldRect.top - bodyTop - margin)));
}

/**
 * @param {{ bodyRef }} refs  the form's scroll area
 * @returns attributes for the overlay element
 */
export function useKeyboardOverlayForm({ bodyRef }) {
  useEffect(() => {
    if (!KEYBOARD_OVERLAYS_PAGE) return undefined;
    let frame = 0;

    const reveal = (inset, duration) => {
      cancelAnimationFrame(frame);
      // A frame later, once layout has the room the stylesheet gives the form.
      frame = requestAnimationFrame(() => {
        const body = bodyRef.current;
        const field = document.activeElement;
        if (!body || !field || !body.contains(field) || !(inset > 0)) return;
        const overlap = revealOverlap({
          fieldRect: field.getBoundingClientRect(),
          bodyTop: body.getBoundingClientRect().top,
          viewportHeight: window.innerHeight,
          inset,
        });
        if (!overlap) return;
        const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        (scrollableAncestor(field) || body).scrollBy({
          top: overlap,
          behavior: duration > 0 && !reduced ? 'smooth' : 'instant',
        });
      });
    };

    const onIme = (event) => {
      const { visible, height, duration } = event.detail || {};
      if (visible && height > 0) reveal(Math.round(height), Math.round(Number(duration) || 0));
    };
    // Moving to another field while the keyboard is already up.
    const onFocusIn = () => {
      const inset = keyboardInset();
      if (inset > 0) reveal(inset, 0);
    };

    window.addEventListener('meetifyy:ime', onIme);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('meetifyy:ime', onIme);
      document.removeEventListener('focusin', onFocusIn);
    };
  }, [bodyRef]);

  return KEYBOARD_OVERLAYS_PAGE ? { 'data-keyboard-dock': '', 'data-keyboard-overlay': '' } : {};
}
