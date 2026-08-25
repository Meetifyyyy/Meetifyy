import { useEffect } from 'react';

/**
 * Tracks the on-screen keyboard and publishes it to CSS on <html>:
 *
 *   --kb-inset         how much of the LAYOUT viewport the keyboard covers
 *   --kb-layout-shift  how much the LAYOUT viewport itself shrank
 *   data-keyboard-open present whenever either of the above is non-zero
 *
 * Two variables because browsers do two different things with a keyboard, and
 * only one of them was being measured:
 *
 *   • iOS / `interactive-widget=resizes-visual`: the layout viewport keeps its
 *     full height and the visual viewport shrinks. `innerHeight - vv.height`
 *     is the keyboard height, and a `position: fixed; bottom: 0` element stays
 *     at the bottom of the full-height layout viewport — physically behind the
 *     keyboard, which is where we want it. Here --kb-inset > 0 and
 *     --kb-layout-shift is 0.
 *
 *   • Android / `interactive-widget=resizes-content` (the default): the layout
 *     viewport shrinks too, so `innerHeight - vv.height` is ~0 — the keyboard
 *     was invisible to the old measurement. And because `bottom: 0` now means
 *     the bottom of the *shrunk* viewport, a fixed bottom bar is lifted to sit
 *     directly on top of the keyboard. --kb-layout-shift is that lift, and the
 *     bottom nav translates down by it to stay put on the physical screen.
 */

/** Below this a height change is browser chrome (URL bar), not a keyboard. */
const KEYBOARD_MIN_HEIGHT = 80;

function isTextFieldFocused() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

export function useKeyboardInset() {
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return;

    const root = document.documentElement;
    let raf = 0;
    let lastInset = -1;
    let lastShift = -1;
    // Tallest layout viewport seen with no keyboard up — the height to compare
    // against. Only ever grows (and resets on orientation change), so a shrink
    // caused by the keyboard cannot quietly become the new normal.
    let baseline = window.innerHeight;

    const apply = () => {
      raf = 0;
      const innerHeight = window.innerHeight;
      const focused = isTextFieldFocused();

      // Overlap between the layout viewport bottom and the visual viewport
      // bottom = the space the keyboard is occupying (0 when closed).
      const inset = Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop));

      if (innerHeight > baseline) baseline = innerHeight;

      // A layout shrink counts as the keyboard only while a text field holds
      // focus. Otherwise the URL bar collapsing on scroll would read as one and
      // shove the nav off screen mid-scroll.
      const rawShift = Math.max(0, baseline - innerHeight);
      const shift = focused && rawShift >= KEYBOARD_MIN_HEIGHT ? rawShift : 0;

      if (inset === lastInset && shift === lastShift) return;
      lastInset = inset;
      lastShift = shift;

      root.style.setProperty('--kb-inset', `${inset}px`);
      root.style.setProperty('--kb-layout-shift', `${shift}px`);
      if (inset > 0 || shift > 0) root.setAttribute('data-keyboard-open', '');
      else root.removeAttribute('data-keyboard-open');
    };

    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(apply);
    };

    const resetBaseline = () => {
      baseline = window.innerHeight;
      schedule();
    };

    apply();
    vv.addEventListener('resize', schedule);
    vv.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    // Focus/blur drive the shift gate above, and on Android they are also the
    // only events that fire when the keyboard opens without the visual
    // viewport changing at all.
    window.addEventListener('focusin', schedule);
    window.addEventListener('focusout', schedule);
    window.addEventListener('orientationchange', resetBaseline);

    return () => {
      vv.removeEventListener('resize', schedule);
      vv.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('focusin', schedule);
      window.removeEventListener('focusout', schedule);
      window.removeEventListener('orientationchange', resetBaseline);
      if (raf) cancelAnimationFrame(raf);
      root.style.setProperty('--kb-inset', '0px');
      root.style.setProperty('--kb-layout-shift', '0px');
      root.removeAttribute('data-keyboard-open');
    };
  }, []);
}
