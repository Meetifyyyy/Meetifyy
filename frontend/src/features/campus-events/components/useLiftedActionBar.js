import { useEffect } from 'react';
import { KEYBOARD_OVERLAYS_PAGE } from '@shared/utils/keyboardOverlay';
import { keyboardInset } from '@shared/utils/visibleViewport';
import { scrollableAncestor } from '@shared/utils/keyboardFocus';

/**
 * A full-screen form whose action bar rides on the keyboard, in the installed
 * Android app (where the keyboard overlays a WebView that never resizes).
 *
 * The page keeps its size. The stylesheet (CampusEventForm.module.css) lifts the
 * bar with a transform on the keyboard's own duration and curve, and gives the
 * scroll area the room the bar and keyboard cover. That is ONE movement, in
 * step with the keyboard. Shrinking the page by layout instead (padding the
 * overlay by --kb-inset) moves the footer in the frame the keyboard starts, and
 * the app-wide slide for sheets (keyboardSheetRise) then replays a second
 * movement on top of it - the "moves up twice" bug.
 *
 * What is left for the page to do is scrolling the focused field clear of the
 * keyboard AND of the bar that now sits on it. The app-wide helper
 * (ensureFocusedVisible) only knows about the keyboard, so the surface opts out
 * with `data-keyboard-dock` and does it here, once per keyboard show and once per
 * focus change while it is up.
 */

/** Space kept between the field and what covers it. */
const MARGIN_PX = 12;

/**
 * How far the scroll area must scroll to bring a field above the lifted bar,
 * or 0. Never past the field's own top (a tall field keeps its start visible).
 * Pure, so it can be tested without a device.
 */
export function revealOverlap({ fieldRect, bodyTop, viewportHeight, lift, barHeight, margin = MARGIN_PX }) {
  const limit = viewportHeight - lift - barHeight - margin;
  const overlap = Math.ceil(fieldRect.bottom - limit);
  if (overlap <= 0) return 0;
  return Math.max(0, Math.min(overlap, Math.floor(fieldRect.top - bodyTop - margin)));
}

/**
 * @param {{ bodyRef, barRef, safeRef }} refs  the scroll area, the action bar,
 *   and an empty element sized `env(safe-area-inset-bottom)` (the part of the
 *   keyboard's height the bar's own padding already clears).
 * @returns attributes for the overlay element
 */
export function useLiftedActionBar({ bodyRef, barRef, safeRef }) {
  useEffect(() => {
    if (!KEYBOARD_OVERLAYS_PAGE) return undefined;
    let frame = 0;

    const reveal = (inset, duration) => {
      cancelAnimationFrame(frame);
      // A frame later, once layout has the room the stylesheet gives the form.
      frame = requestAnimationFrame(() => {
        const body = bodyRef.current;
        const bar = barRef.current;
        const field = document.activeElement;
        if (!body || !bar || !field || !body.contains(field) || !(inset > 0)) return;
        const lift = Math.max(0, inset - (safeRef.current?.offsetHeight || 0));
        const overlap = revealOverlap({
          fieldRect: field.getBoundingClientRect(),
          bodyTop: body.getBoundingClientRect().top,
          viewportHeight: window.innerHeight,
          lift,
          barHeight: bar.offsetHeight,
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
  }, [bodyRef, barRef, safeRef]);

  return KEYBOARD_OVERLAYS_PAGE ? { 'data-keyboard-dock': '', 'data-keyboard-overlay': '' } : {};
}
