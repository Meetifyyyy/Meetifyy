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

/**
 * Exported because `useAutoHideChrome` needs the same answer, synchronously.
 * The `data-keyboard-open` attribute below is written on a rAF, and the scroll
 * handler that consults it also runs on a rAF — so on the frame the keyboard
 * opens, which of the two lands first is not defined. Focus is set before
 * either, so it is the signal that cannot be raced.
 */
const NON_TEXT_INPUTS = new Set([
  'button', 'checkbox', 'radio', 'file', 'range', 'color', 'submit', 'reset', 'image',
]);

export function isTextFieldFocused() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  // A checkbox or file input is an INPUT too, but raises no keyboard.
  if (tag === 'INPUT') return !NON_TEXT_INPUTS.has((el.type || '').toLowerCase());
  return tag === 'TEXTAREA' || el.isContentEditable;
}

export function useKeyboardInset() {
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return;

    const root = document.documentElement;
    let raf = 0;
    let lastInset = -1;
    let lastShift = -1;
    let lastAppVh = -1;
    let keyboardSeen = false;
    let lastWidth = window.innerWidth;
    const coarse = window.matchMedia?.('(pointer: coarse)').matches;
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

      // Grows only on touch devices: there the keyboard shrinks the viewport,
      // and it must never become the baseline — including in the frames after
      // blur while it is still sliding away. A desktop has no on-screen
      // keyboard, so there the baseline follows the window both ways (a window
      // made shorter must not leave --app-vh at its old, taller height).
      // A change of WIDTH is a rotation (the keyboard never changes it): start
      // over, or landscape would keep portrait's taller baseline.
      if (innerWidth !== lastWidth) {
        lastWidth = innerWidth;
        baseline = innerHeight;
      }
      if (innerHeight > baseline || !coarse) baseline = innerHeight;

      // --app-vh: 1% of the viewport height WITHOUT the keyboard. `vh` follows
      // the layout viewport, which the Android WebView shrinks when the
      // keyboard opens, so anything sized in `vh` (post media in the feed)
      // shrank under the keyboard and re-laid out the whole feed with it.
      if (baseline !== lastAppVh) {
        lastAppVh = baseline;
        root.style.setProperty('--app-vh', `${baseline / 100}px`);
      }

      // A layout shrink counts as the keyboard only while a text field holds
      // focus. Otherwise the URL bar collapsing on scroll would read as one and
      // shove the nav off screen mid-scroll.
      const rawShift = Math.max(0, baseline - innerHeight);
      const shift = focused && rawShift >= KEYBOARD_MIN_HEIGHT ? rawShift : 0;

      if (inset === lastInset && shift === lastShift) return;
      lastInset = inset;
      lastShift = shift;

      // Text entry ends when the keyboard has fully gone, not at blur:
      //  - Android's Back hides the keyboard but leaves the field focused, so
      //    waiting for blur kept the nav hidden with no keyboard on screen;
      //  - dropping it at blur showed the nav over a keyboard still sliding away.
      // `keyboardSeen` stops the frames between focus and the keyboard's first
      // resize from counting as "closed". A focus that never raises a keyboard
      // (hardware keyboard) ends at blur.
      const keyboardUp = inset > 0 || rawShift >= KEYBOARD_MIN_HEIGHT;
      if (keyboardUp) {
        keyboardSeen = true;
        // A slow IME can raise the keyboard after the no-keyboard timer gave up.
        if (!root.hasAttribute('data-text-entry')) root.setAttribute('data-text-entry', '');
      }
      else if (keyboardSeen || !focused) {
        // Announce a keyboard that really closed (not a focus that never raised
        // one), so a screen can put itself back: Back hides the keyboard but
        // leaves the field focused, and nothing else says it happened.
        if (keyboardSeen) window.dispatchEvent(new Event('meetifyy:keyboard-hidden'));
        keyboardSeen = false;
        root.removeAttribute('data-text-entry');
      }

      root.style.setProperty('--kb-inset', `${inset}px`);
      root.style.setProperty('--kb-layout-shift', `${shift}px`);
      if (inset > 0 || shift > 0) root.setAttribute('data-keyboard-open', '');
      else root.removeAttribute('data-keyboard-open');
    };

    /**
     * `data-text-entry`: set SYNCHRONOUSLY on focus, before the keyboard has
     * resized anything, so the bottom nav and the Match button are already
     * hidden in the frame the WebView shrinks. Waiting for the resize meant one
     * or two frames with them lifted onto the keyboard's top edge (Android:
     * `bottom: 0` follows the shrunk viewport before --kb-layout-shift lands).
     * Touch devices only: a desktop keyboard covers nothing.
     */
    // If no keyboard follows (a tap that did not reach the text, a hardware
    // keyboard), the chrome must not stay hidden: give it up after a moment.
    let noKeyboardTimer = 0;
    const beginTextEntry = () => {
      root.setAttribute('data-text-entry', '');
      clearTimeout(noKeyboardTimer);
      noKeyboardTimer = setTimeout(() => {
        if (!keyboardSeen) root.removeAttribute('data-text-entry');
      }, 800);
    };
    const onFocusIn = () => {
      if (coarse && isTextFieldFocused()) beginTextEntry();
    };
    // After Back has hidden the keyboard the field keeps focus, so tapping it
    // again reopens the keyboard with no focusin. The touch is the signal.
    const onTouchStart = (e) => {
      const el = document.activeElement;
      if (coarse && isTextFieldFocused() && el.contains(e.target)) beginTextEntry();
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
    window.addEventListener('focusin', onFocusIn);
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('focusin', schedule);
    window.addEventListener('focusout', schedule);
    window.addEventListener('orientationchange', resetBaseline);

    return () => {
      vv.removeEventListener('resize', schedule);
      vv.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('focusin', onFocusIn);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('focusin', schedule);
      clearTimeout(noKeyboardTimer);
      root.removeAttribute('data-text-entry');
      window.removeEventListener('focusout', schedule);
      window.removeEventListener('orientationchange', resetBaseline);
      if (raf) cancelAnimationFrame(raf);
      root.style.setProperty('--kb-inset', '0px');
      root.style.setProperty('--kb-layout-shift', '0px');
      root.removeAttribute('data-keyboard-open');
    };
  }, []);
}
