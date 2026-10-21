import { useEffect } from 'react';
import { KEYBOARD_OVERLAYS_PAGE } from '@shared/utils/keyboardOverlay';

/**
 * Scroll room for an overlaying keyboard, without moving the page.
 *
 * In the installed Android app the keyboard overlays the page (see
 * useKeyboardInset). A full-screen scroller still needs somewhere to scroll TO
 * so its last field and its submit button can be brought above the keyboard.
 * The obvious way, `padding-bottom: var(--kb-inset)`, is a layout change: a
 * vertically centred page re-centred in the smaller area in ONE frame, at the
 * start of the keyboard's ~250ms slide, so the whole screen jumped up before
 * the keyboard had moved, and jumped back the same way when it left (measured:
 * the login page moved 109px in a single frame each way).
 *
 * This publishes the room as `--kb-room` on the scroller instead, for
 * `.shell::after` (authKit.module.css) to occupy. That box has the room's
 * height and an equal negative bottom margin, so it extends what can be
 * scrolled without taking any space in the layout: nothing is re-centred or
 * moved. What brings a covered field into view is the same smooth scroll the
 * rest of the app uses (ensureFocusedVisible, run by useKeyboardInset).
 *
 * Opening: the room appears at once, before the page is measured.
 *
 * Closing: if the page was scrolled up to clear the keyboard, the room cannot
 * simply vanish (the scroll position would clamp in one frame). The scroller is
 * first scrolled back, smoothly, to where it will be able to rest, and the room
 * is released when that has finished. Nothing is released early and nothing is
 * a timer standing in for the scroll: `scrollend` says when, with a ceiling for
 * a scroller that never reports it.
 *
 * Only where the keyboard overlays the page. Everywhere else the browser or the
 * layout already makes room, and this does nothing.
 *
 * @param {React.RefObject<HTMLElement>} ref  the scroller
 */
const RELEASE_CEILING_MS = 700;

export function useKeyboardRoom(ref) {
  useEffect(() => {
    if (!KEYBOARD_OVERLAYS_PAGE || typeof window === 'undefined') return undefined;
    const el = ref.current;
    if (!el) return undefined;

    let ceiling = 0;
    let waiting = null;

    const cancelRelease = () => {
      clearTimeout(ceiling);
      ceiling = 0;
      if (waiting) {
        el.removeEventListener('scrollend', waiting);
        waiting = null;
      }
    };

    const releaseRoom = () => {
      cancelRelease();
      el.style.setProperty('--kb-room', '0px');
    };

    const onIme = (event) => {
      const detail = event?.detail || {};
      const height = Math.max(0, Math.round(Number(detail.height) || 0));
      cancelRelease();

      if (detail.visible && height > 0) {
        el.style.setProperty('--kb-room', `${height}px`);
        return;
      }

      const room = Number.parseFloat(el.style.getPropertyValue('--kb-room')) || 0;
      if (room <= 0) return;

      // Where the scroller will be able to rest once the room is gone.
      const resting = Math.max(0, el.scrollHeight - el.clientHeight - room);
      if (el.scrollTop <= resting + 1) {
        releaseRoom();
        return;
      }

      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (reduced) {
        el.scrollTo({ top: resting, behavior: 'instant' });
        releaseRoom();
        return;
      }
      waiting = releaseRoom;
      el.addEventListener('scrollend', waiting, { once: true });
      ceiling = setTimeout(releaseRoom, RELEASE_CEILING_MS);
      el.scrollTo({ top: resting, behavior: 'smooth' });
    };

    const initialInset = parseFloat(document.documentElement.style.getPropertyValue('--kb-inset')) || 0;
    if (initialInset > 0) onIme({ detail: { visible: true, height: initialInset } });
    window.addEventListener('meetifyy:ime', onIme);
    return () => {
      window.removeEventListener('meetifyy:ime', onIme);
      cancelRelease();
      el.style.removeProperty('--kb-room');
    };
  }, [ref]);
}
