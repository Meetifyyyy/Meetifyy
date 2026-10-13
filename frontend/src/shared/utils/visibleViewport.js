/**
 * The part of the screen the on-screen keyboard does not cover, for anything
 * that places a popover (menus, selects, date/time pickers, mention lists) in
 * viewport coordinates.
 *
 * `visualViewport.height` used to be enough. On iOS and the website the visual
 * viewport shrinks for the keyboard, and in the Android app the WebView itself
 * was resized for it. The app now lets the keyboard OVERLAY the page: neither
 * viewport changes size, and the only record of the keyboard is `--kb-inset`
 * on <html> (useKeyboardInset). A popover measured from `visualViewport` alone
 * would open straight under the keyboard.
 *
 * So the visible bottom is the smaller of the two answers. Where the visual
 * viewport shrinks (iOS, website), `innerHeight - --kb-inset` is that same
 * edge, and taking the minimum never subtracts the keyboard twice.
 */

/** The keyboard's overlap, in px, as published on <html>. 0 when hidden. */
export function keyboardInset() {
  if (typeof document === 'undefined') return 0;
  // The inline style, not getComputedStyle: useKeyboardInset writes it there,
  // and reading it costs no style recalculation.
  const raw = document.documentElement.style.getPropertyValue('--kb-inset');
  const px = Number.parseFloat(raw);
  return Number.isFinite(px) && px > 0 ? px : 0;
}

/**
 * The bottom edge of the visible area, in the same coordinates as
 * `getBoundingClientRect()` (the layout viewport).
 */
export function visibleViewportBottom() {
  if (typeof window === 'undefined') return 0;
  const layout = window.innerHeight;
  const vv = window.visualViewport;
  const visual = vv ? vv.offsetTop + vv.height : layout;
  return Math.max(0, Math.min(visual, layout - keyboardInset()));
}

/**
 * Calls `onChange` whenever the visible area may have changed: a resize of
 * either viewport, or the keyboard starting to show or hide. With the keyboard
 * overlaying the page that last one fires no resize at all, so listening to
 * `resize` alone would leave an open popover where the keyboard now is.
 *
 * Deferred one frame: `meetifyy:ime` and the `--kb-inset` write it announces
 * are not ordered, and reading the inset in the same task could see the old
 * value. Returns the unsubscribe function.
 */
export function onVisibleViewportChange(onChange) {
  if (typeof window === 'undefined') return () => {};
  let raf = 0;
  const schedule = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      onChange();
    });
  };
  const vv = window.visualViewport;
  window.addEventListener('resize', schedule);
  window.addEventListener('meetifyy:ime', schedule);
  window.addEventListener('meetifyy:keyboard-hidden', schedule);
  vv?.addEventListener('resize', schedule);
  return () => {
    if (raf) cancelAnimationFrame(raf);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('meetifyy:ime', schedule);
    window.removeEventListener('meetifyy:keyboard-hidden', schedule);
    vv?.removeEventListener('resize', schedule);
  };
}
