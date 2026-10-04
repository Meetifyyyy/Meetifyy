import { useEffect } from 'react';
import { IS_MOBILE_BUILD } from '@config';

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

const NON_TEXT_INPUTS = new Set([
  'button', 'checkbox', 'radio', 'file', 'range', 'color', 'submit', 'reset', 'image',
  // These raise a picker, not the keyboard.
  'date', 'time', 'datetime-local', 'month', 'week',
]);

/**
 * Exported because `useAutoHideChrome` needs the same answer, synchronously.
 * The `data-keyboard-open` attribute below is written on a rAF, and the scroll
 * handler that consults it also runs on a rAF — so on the frame the keyboard
 * opens, which of the two lands first is not defined. Focus is set before
 * either, so it is the signal that cannot be raced.
 */
export function isTextFieldFocused() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  // A checkbox or file input is an INPUT too, but raises no keyboard.
  if (tag === 'INPUT') {
    return !el.readOnly && !el.disabled && !NON_TEXT_INPUTS.has((el.type || '').toLowerCase());
  }
  return tag === 'TEXTAREA' || el.isContentEditable;
}

/**
 * `data-text-entry` is the INSTALLED APP's way of knowing a keyboard is, or is
 * about to be, on screen. It exists only there (`IS_MOBILE_BUILD`): the website
 * keeps its previous behaviour exactly, including a URL bar that collapses and
 * a pinch zoom, neither of which is a keyboard. What listens to it:
 *   - the feed virtualizer (steady window height),
 *   - inline video (does not pause/resume on a viewport change),
 *   - the system-bar colour sampler (paused while the layout is moving),
 *   - the post composer (expand first, then raise the keyboard).
 * The nav and Instant Match button do NOT depend on it: mobile.css keeps them on
 * the physical bottom edge from the viewport sizes alone.
 *
 * Events, on `window`:
 *   meetifyy:text-entry-end    the attribute was removed, for any reason
 *   meetifyy:keyboard-hidden   a keyboard that was really up has closed
 */
export function useKeyboardInset() {
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return;

    const root = document.documentElement;
    const native = IS_MOBILE_BUILD;
    let raf = 0;
    let lastInset = -1;
    let lastShift = -1;
    let lastAppVh = -1;
    let keyboardSeen = false;
    let lastWidth = window.innerWidth;
    const coarse = window.matchMedia?.('(pointer: coarse)').matches;
    // The layout viewport height with no keyboard up — what the keyboard shrinks
    // from. Grows freely; shrinks only when it is certain no keyboard is the
    // cause (see `apply`), so split-screen or an exited fullscreen video cannot
    // leave it stale.
    let baseline = window.innerHeight;

    const endTextEntry = (keyboardClosed) => {
      const had = root.hasAttribute('data-text-entry');
      keyboardSeen = false;
      root.removeAttribute('data-text-entry');
      // After the attribute is gone, so listeners see the settled state.
      if (keyboardClosed) window.dispatchEvent(new Event('meetifyy:keyboard-hidden'));
      if (had) window.dispatchEvent(new Event('meetifyy:text-entry-end'));
    };

    const apply = () => {
      raf = 0;
      const innerHeight = window.innerHeight;
      const focused = isTextFieldFocused();
      const typing = focused || root.hasAttribute('data-text-entry');

      // Overlap between the layout viewport bottom and the visual viewport
      // bottom = the space the keyboard is occupying (0 when closed).
      const inset = Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop));

      // A change of WIDTH is a rotation (the keyboard never changes it): start
      // over, or landscape would keep portrait's taller baseline.
      if (innerWidth !== lastWidth) {
        lastWidth = innerWidth;
        baseline = innerHeight;
      }
      if (innerHeight > baseline) baseline = innerHeight;

      // A layout shrink counts as the keyboard only while a text field holds
      // focus (or text entry is still winding down after it lost it). Otherwise
      // the URL bar collapsing on scroll would read as one and shove the nav
      // off screen mid-scroll.
      const rawShift = Math.max(0, baseline - innerHeight);
      const shift = focused && rawShift >= KEYBOARD_MIN_HEIGHT ? rawShift : 0;

      // A pinch zoom shrinks the visual viewport too, and is not a keyboard.
      const zoomed = (vv.scale || 1) > 1.01;
      const keyboardUp = typing && !zoomed && (inset >= KEYBOARD_MIN_HEIGHT || rawShift >= KEYBOARD_MIN_HEIGHT);

      // With no keyboard to blame, whatever the viewport is now IS the baseline.
      // (Desktop has no on-screen keyboard, so it always follows the window.)
      if (!keyboardUp && (!typing || !coarse)) baseline = innerHeight;

      // --app-vh: 1% of the viewport height WITHOUT the keyboard. `vh` follows
      // the layout viewport, which the Android WebView shrinks when the
      // keyboard opens, so anything sized in `vh` (post media in the feed)
      // shrank under the keyboard and re-laid out the whole feed with it. The
      // website's `vh` is stable already, and an --app-vh that followed its
      // collapsing URL bar would resize media mid-scroll, so only the app has it.
      if (native && baseline !== lastAppVh) {
        lastAppVh = baseline;
        root.style.setProperty('--app-vh', `${baseline / 100}px`);
      }

      // Text entry ends when the keyboard has fully gone, not at blur:
      //  - Android's Back hides the keyboard but leaves the field focused, so
      //    waiting for blur would never end it;
      //  - ending it at blur would be while the keyboard is still sliding away.
      // `keyboardSeen` stops the frames between focus and the keyboard's first
      // resize from counting as "closed". Evaluated on EVERY pass, before the
      // dedupe below: the final resize of a closing keyboard changes none of the
      // published numbers, and was being skipped, leaving the attribute stuck on.
      if (native) {
        if (keyboardUp) {
          keyboardSeen = true;
          // A slow keyboard can arrive after the no-keyboard timer gave up.
          if (!root.hasAttribute('data-text-entry')) root.setAttribute('data-text-entry', '');
        } else if (keyboardSeen) {
          endTextEntry(true);
        } else if (!focused && root.hasAttribute('data-text-entry')) {
          endTextEntry(false);
        }
      }

      if (inset === lastInset && shift === lastShift) return;
      lastInset = inset;
      lastShift = shift;

      root.style.setProperty('--kb-inset', `${inset}px`);
      root.style.setProperty('--kb-layout-shift', `${shift}px`);
      if (inset > 0 || shift > 0) root.setAttribute('data-keyboard-open', '');
      else root.removeAttribute('data-keyboard-open');
    };

    /**
     * Set SYNCHRONOUSLY on focus, before the keyboard has resized anything, so
     * everything that listens is already in the right state in the frame the
     * WebView shrinks. If no keyboard follows (a tap that did not reach the
     * text, a hardware keyboard) it is given up after a moment.
     */
    let noKeyboardTimer = 0;
    const beginTextEntry = () => {
      root.setAttribute('data-text-entry', '');
      clearTimeout(noKeyboardTimer);
      noKeyboardTimer = setTimeout(() => {
        if (!keyboardSeen) endTextEntry(false);
      }, 800);
    };
    const onFocusIn = () => {
      if (native && coarse && isTextFieldFocused()) beginTextEntry();
    };
    // After Back has hidden the keyboard the field keeps focus, so tapping it
    // again reopens the keyboard with no focusin. The touch is the signal.
    const onTouchStart = (e) => {
      if (!native || !coarse || keyboardSeen) return;
      const el = document.activeElement;
      if (isTextFieldFocused() && el.contains(e.target)) beginTextEntry();
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
      window.removeEventListener('focusout', schedule);
      window.removeEventListener('orientationchange', resetBaseline);
      clearTimeout(noKeyboardTimer);
      if (root.hasAttribute('data-text-entry')) endTextEntry(false);
      if (raf) cancelAnimationFrame(raf);
      root.style.setProperty('--kb-inset', '0px');
      root.style.setProperty('--kb-layout-shift', '0px');
      root.removeAttribute('data-keyboard-open');
    };
  }, []);
}
