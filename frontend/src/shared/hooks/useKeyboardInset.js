import { useEffect } from 'react';
import { IS_MOBILE_BUILD } from '@config';
import { ensureFocusedVisible } from '@shared/utils/keyboardFocus';
import { KEYBOARD_OVERLAYS_PAGE } from '@shared/utils/keyboardOverlay';

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
 *     (The website on Android; NOT the installed app, below.)
 *
 * The installed Android app does neither: the keyboard OVERLAYS the page and
 * the WebView never resizes for it (SystemUiPlugin). Every resize step used to
 * cost the page 60-90ms of restyle and relayout in the middle of the slide.
 * The native side instead tells the page once per transition, at the START of
 * the IME animation:
 *
 *   window 'meetifyy:ime'  detail { visible, height, duration }
 *     height    CSS px of the bottom of the page the keyboard covers, the
 *               navigation bar's area included (0 when hiding) — the same
 *               meaning --kb-inset has on iOS. The keyboard's top edge is at
 *               innerHeight - height. A docked bar that already pads for the
 *               navigation bar rises by height - env(safe-area-inset-bottom).
 *     duration  ms of the IME animation, 0 for a jump
 *     startedAt epoch ms (Date.now() clock) when the IME animation started
 *
 * and this hook turns that into ONE synchronous write on <html> per transition:
 *
 *   --kb-inset         = height
 *   --kb-duration      = duration (mobile.css defaults it to 0ms, and pairs it
 *                        with --kb-easing, the IME's own curve)
 *   --kb-delay         = minus how long ago the keyboard started moving
 *                        (detail.startedAt, an epoch-ms timestamp taken in
 *                        onStart, plus the frames the transition takes to
 *                        reach the screen). A negative transition-delay starts
 *                        the page's transition that far into its curve, so it
 *                        runs in step with the keyboard instead of behind it
 *                        (measured on a device without it: 66ms behind on
 *                        open, 51ms on close, enough for the keyboard to
 *                        cover a docked composer for half of its slide).
 *   data-keyboard-open toggled
 *
 * Ordering: the native side dispatches `meetifyy:ime`; this hook's own
 * listener (registered at app mount, so normally first) writes the above
 * synchronously inside that dispatch. Listener order is not a guarantee, so
 * another listener must not read --kb-inset in the same task: read
 * `event.detail`, or wait a frame. The focused field is checked a frame
 * later still (ensureFocusedVisible), once layout has the new room.
 *
 * Consumers lift with a compositor-only transform on that duration and curve:
 *   transform: translate3d(0, calc(-1 * var(--kb-inset, 0px)), 0);
 *   transition: transform var(--kb-duration, 0ms) var(--kb-easing, ease-out) var(--kb-delay, 0ms);
 * and give scroll containers room with padding-bottom / scroll-padding-bottom:
 * var(--kb-inset, 0px). Nothing is written per frame. --kb-layout-shift stays
 * 0 there and --app-vh is simply 1% of the (constant) viewport height.
 * On iOS and the website there is no --kb-duration (consumers fall back to 0ms).
 */

/**
 * Time between writing the keyboard's inset and the page's transition first
 * moving on screen (style, layout, commit, compositor start), measured on a
 * device as the open/close lag minus the event's delivery time. Opening costs
 * more: it is where focus, the composer's own state and the thread's padding
 * land. With these, both transitions start within ~5ms of the keyboard.
 */
const TRANSITION_START_MS = { show: 40, hide: 25 };

/** Below this a height change is browser chrome (URL bar), not a keyboard. */
const KEYBOARD_MIN_HEIGHT = 80;
/** Past the largest bottom-nav clearance (52px + the gesture/3-button bar). */
const SHIFT_CAP_PX = 160;

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
 *   - the post composer (collapses an empty composer when the keyboard closes).
 * The nav and Instant Match button do NOT depend on it: in the app the keyboard
 * overlays them where they are.
 *
 * Events, on `window`:
 *   meetifyy:text-entry-end    the attribute was removed, for any reason
 *   meetifyy:keyboard-hidden   a keyboard that was really up has closed
 */
export function useKeyboardInset() {
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const root = document.documentElement;
    const native = IS_MOBILE_BUILD;
    // The installed app on Android: the keyboard overlays the page, and the
    // native side reports it (see the top of this file). Nothing below this
    // branch runs there.
    if (KEYBOARD_OVERLAYS_PAGE) return installOverlay(root);

    const vv = window.visualViewport;
    if (!vv) return undefined;

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
      const exactShift = focused && rawShift >= KEYBOARD_MIN_HEIGHT ? rawShift : 0;
      // In the app the shift is only ever compared with the bottom-nav
      // clearance (global.css, Messages), so any value past it means the same
      // thing. Capped there, it stops changing after the first resize step:
      // every new value written on <html> restyles the whole page.
      const shift = native ? Math.min(exactShift, SHIFT_CAP_PX) : exactShift;

      // A pinch zoom shrinks the visual viewport too, and is not a keyboard.
      const zoomed = (vv.scale || 1) > 1.01;
      const keyboardUp = typing && !zoomed && (inset >= KEYBOARD_MIN_HEIGHT || rawShift >= KEYBOARD_MIN_HEIGHT);

      // With no keyboard to blame, whatever the viewport is now IS the baseline.
      // (Desktop has no on-screen keyboard, so it always follows the window.)
      if (!keyboardUp && (!typing || !coarse)) baseline = innerHeight;

      // --app-vh: 1% of the viewport height WITHOUT the keyboard. `vh` follows
      // the layout viewport, which a resizing keyboard shrinks, so anything
      // sized in `vh` (post media in the feed) shrank under it and re-laid out
      // the whole feed. The website's `vh` is stable already, and an --app-vh
      // that followed its collapsing URL bar would resize media mid-scroll, so
      // only the app has it.
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
      // Only on a real change: each attribute write is a style invalidation.
      const open = inset > 0 || shift > 0;
      if (open !== root.hasAttribute('data-keyboard-open')) {
        if (open) root.setAttribute('data-keyboard-open', '');
        else root.removeAttribute('data-keyboard-open');
      }
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

/**
 * The installed Android app: the keyboard overlays the page and `meetifyy:ime`
 * says where it is going (see the top of this file). Returns the cleanup.
 *
 * Text entry keeps the same meaning and events as the resize path:
 * `data-text-entry` goes on synchronously at focus (or at a touch on a field
 * that kept focus after Back), and ends once a keyboard that was really up has
 * finished sliding away — the IME's own duration after the hide event — with
 * `meetifyy:keyboard-hidden` then `meetifyy:text-entry-end`. A focus that no
 * keyboard follows (hardware keyboard, a tap that missed the text) gives up
 * after 800ms, as before.
 */
function installOverlay(root) {
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  let keyboardSeen = false;
  let lastInset = -1;
  let lastDuration = -1;
  let lastDelay = 0;
  let noKeyboardTimer = 0;
  let hideTimer = 0;
  let raf = 0;
  let focusFrame = 0;

  // Never written per transition: nothing resizes for the keyboard here.
  root.style.setProperty('--kb-layout-shift', '0px');

  // --app-vh is the full height, which the keyboard no longer changes. It
  // still follows a rotation or split-screen.
  let lastAppVh = -1;
  const writeAppVh = () => {
    raf = 0;
    const h = window.innerHeight;
    if (h === lastAppVh) return;
    lastAppVh = h;
    root.style.setProperty('--app-vh', `${h / 100}px`);
  };
  writeAppVh();
  const onResize = () => {
    if (!raf) raf = requestAnimationFrame(writeAppVh);
  };

  const endTextEntry = (keyboardClosed) => {
    const had = root.hasAttribute('data-text-entry');
    keyboardSeen = false;
    root.removeAttribute('data-text-entry');
    if (keyboardClosed) window.dispatchEvent(new Event('meetifyy:keyboard-hidden'));
    if (had) window.dispatchEvent(new Event('meetifyy:text-entry-end'));
  };

  const beginTextEntry = () => {
    root.setAttribute('data-text-entry', '');
    clearTimeout(noKeyboardTimer);
    noKeyboardTimer = setTimeout(() => {
      if (!keyboardSeen) endTextEntry(false);
    }, 800);
  };
  const onFocusIn = () => {
    if (coarse && isTextFieldFocused()) beginTextEntry();
  };
  const onTouchStart = (e) => {
    if (!coarse || keyboardSeen) return;
    const el = document.activeElement;
    if (isTextFieldFocused() && el.contains(e.target)) beginTextEntry();
  };

  const onIme = (e) => {
    const detail = e?.detail || {};
    const height = Math.max(0, Math.round(Number(detail.height) || 0));
    const visible = Boolean(detail.visible) && height > 0;
    const duration = Math.max(0, Math.round(Number(detail.duration) || 0));
    const inset = visible ? height : 0;
    // How far behind the keyboard this write lands: delivery from onStart, plus
    // the frames the transition takes to start on screen. Rounded so the value
    // only changes when the lag really does.
    const startedAt = Number(detail.startedAt) || 0;
    const behind = startedAt > 0
      ? Math.max(0, Date.now() - startedAt) + TRANSITION_START_MS[visible ? 'show' : 'hide']
      : 0;
    const delay = -Math.min(duration, Math.round(behind / 10) * 10);
    if (!visible && focusFrame) {
      cancelAnimationFrame(focusFrame);
      focusFrame = 0;
    }

    // The one write per transition. The duration first, in the same style
    // pass as the inset, so the transition that the inset starts uses it.
    if (duration !== lastDuration) {
      lastDuration = duration;
      root.style.setProperty('--kb-duration', `${duration}ms`);
    }
    if (delay !== lastDelay) {
      lastDelay = delay;
      root.style.setProperty('--kb-delay', `${delay}ms`);
    }
    if (inset !== lastInset) {
      lastInset = inset;
      root.style.setProperty('--kb-inset', `${inset}px`);
    }
    if (visible !== root.hasAttribute('data-keyboard-open')) {
      if (visible) root.setAttribute('data-keyboard-open', '');
      else root.removeAttribute('data-keyboard-open');
    }

    if (visible) {
      clearTimeout(hideTimer);
      hideTimer = 0;
      keyboardSeen = true;
      if (!root.hasAttribute('data-text-entry')) root.setAttribute('data-text-entry', '');
      // A frame later, so layout already has the room the write above gave
      // (a page's padding-bottom of --kb-inset) before the field is measured
      // and scrolled into it.
      cancelAnimationFrame(focusFrame);
      focusFrame = requestAnimationFrame(() => {
        focusFrame = 0;
        ensureFocusedVisible({ inset, duration });
      });
    } else if (keyboardSeen) {
      // Ended once the keyboard has gone, not as it starts to leave: what
      // listens resumes work (sampling, video) that would otherwise land in
      // the middle of the slide.
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        hideTimer = 0;
        endTextEntry(true);
      }, duration);
    }
  };

  window.addEventListener('meetifyy:ime', onIme);
  window.addEventListener('resize', onResize);
  window.addEventListener('focusin', onFocusIn);
  window.addEventListener('touchstart', onTouchStart, { passive: true });

  return () => {
    window.removeEventListener('meetifyy:ime', onIme);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('focusin', onFocusIn);
    window.removeEventListener('touchstart', onTouchStart);
    clearTimeout(noKeyboardTimer);
    clearTimeout(hideTimer);
    if (raf) cancelAnimationFrame(raf);
    if (focusFrame) cancelAnimationFrame(focusFrame);
    if (root.hasAttribute('data-text-entry')) endTextEntry(false);
    root.style.setProperty('--kb-inset', '0px');
    root.style.setProperty('--kb-duration', '0ms');
    root.style.setProperty('--kb-delay', '0ms');
    root.removeAttribute('data-keyboard-open');
  };
}
