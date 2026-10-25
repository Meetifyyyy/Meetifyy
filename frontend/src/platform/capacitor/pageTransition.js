import { Capacitor, registerPlugin } from '@capacitor/core';
import {
  DEFAULT_PAGE_EFFECT,
  nextPageCommit,
  pageEffectOrDefault,
  pageEffectPlayArgs,
  pageEffectSnapshot,
} from '@shared/lib/navigation/pageTransition';

/**
 * The shared open/close motions (shared/lib/navigation/pageTransition.js: the
 * slide and the centre opening), drawn by the Android shell.
 *
 * WHY THE SHELL
 * The WebView holds one page at a time, so the page being left has to be kept
 * as a picture. A View Transition would keep one, but on the I2208 capturing
 * it froze the screen for 180-250ms before anything moved and blinded the
 * bars' sampling (see themeReveal.js, which left it for the same reasons).
 *
 * WHAT HAPPENS (PageTransitionPlugin.java)
 *  1. `begin` - the shell screenshots the window and lays the picture over the
 *     WebView. The screen looks exactly as it did.
 *  2. The page navigates underneath, out of sight, and the router root reports
 *     when the new page's DOM is in (`nextPageCommit`); two frames later its
 *     layout, scroll restoration and first paint are done.
 *  3. `play` - once the WebView has that painted, the shell moves the live
 *     WebView and the picture together, natively, every frame, in the effect
 *     the page was opened with (`effect`: which one is drawn, and how, is the
 *     shell's PageEffect).
 *
 * WHEN BACK IS PRESSED WHILE A PAGE IS OPENING
 * The motion turns round from where it is (`reverse`) and the page slides back
 * out; once it is gone the navigation is undone under the picture and the
 * picture removed. Before the page has moved at all, the open is simply
 * abandoned: nothing visible ever changed. A Back pressed while a page is
 * already closing is ignored, as is a second open: one navigation at a time.
 * A tap on the page coming back while it is still settling lands that motion
 * at once and opens from there.
 *
 * Wherever the shell cannot draw it (iOS, Android below 8, a failed capture),
 * or the user has asked for reduced motion, pages simply navigate.
 */

const PageTransition = registerPlugin('PageTransition');

/**
 * Longest wait for the new page to reach the DOM. A first open loads the
 * page's code from inside the app; anything slower than this is not going to
 * look like a transition, so the picture is removed and the page shown as it is.
 */
const COMMIT_TIMEOUT_MS = 1200;

/** Two frames: the new page's style, layout and paint have been committed. */
const afterPaint = () =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

const prefersReducedMotion = () => {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
  } catch {
    return false;
  }
};

const isUnsupported = (error) => /unsupported/i.test(String(error?.code || error?.message || error));

/**
 * What `play` is given: the effect's motion, with what depends on the theme on
 * screen and on the page that was pictured (`snapshot`).
 */
function motion(effect, direction, snapshot = null) {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  return pageEffectPlayArgs(effect, direction, dark, snapshot);
}

/**
 * @returns the driver, or null where the shell cannot draw the motion (pages
 *   then navigate as they always have).
 */
export function createNativePageTransitionDriver() {
  if (Capacitor.getPlatform() !== 'android' || !Capacitor.isPluginAvailable('PageTransition')) {
    return null;
  }

  /** Set once the shell has said it cannot capture; every later navigation is plain. */
  let unsupported = false;
  /**
   * The transition in progress:
   *   { kind: 'open' | 'close',
   *     phase: 'capturing' | 'navigating' | 'playing' | 'returning',
   *     back }   for an open: the Back that overtook it, run once it is undone
   */
  let busy = null;
  /** Settles when the transition in progress has fully ended. */
  let current = Promise.resolve();

  /** The picture comes off; the screen shows the page as it now is. */
  const removePicture = () => PageTransition.finish().catch(() => {});

  /**
   * An open overtaken by Back, once the picture of the page it came from is
   * covering the screen again: undo the navigation underneath, then uncover it.
   */
  const returnUnder = async (job) => {
    job.phase = 'returning';
    const landed = nextPageCommit(COMMIT_TIMEOUT_MS);
    job.back();
    if (await landed) await afterPaint();
    await removePicture();
  };

  const runOpen = async (go, effect) => {
    const job = { kind: 'open', phase: 'capturing', back: null };
    busy = job;
    try {
      try {
        await PageTransition.begin({ effect });
      } catch (error) {
        if (isUnsupported(error)) unsupported = true;
        // Nothing is on screen yet: navigate without the motion, unless Back
        // already took the request back.
        if (!job.back) go();
        return;
      }
      if (job.back) {
        // Back before anything changed: there is nothing to undo.
        await removePicture();
        return;
      }

      job.phase = 'navigating';
      const landed = nextPageCommit(COMMIT_TIMEOUT_MS);
      go();
      if (!(await landed)) {
        await removePicture();
        return;
      }
      await afterPaint();
      if (job.back) {
        await returnUnder(job);
        return;
      }

      job.phase = 'playing';
      let result;
      try {
        result = await PageTransition.play(motion(effect, 'open'));
      } catch {
        await removePicture();
        result = { state: 'done' };
      }
      if (result?.state === 'reversed') {
        await returnUnder(job);
        return;
      }
    } finally {
      busy = null;
    }
    // Back arrived as the page landed, too late to turn it round: close it.
    if (job.back) current = runClose(job.back, effect);
  };

  const runClose = async (go, effect) => {
    busy = { kind: 'close', phase: 'capturing' };
    // Asked now, while the page being left is still on screen: once the
    // navigation has run it is gone.
    const snapshot = pageEffectSnapshot(effect);
    try {
      try {
        await PageTransition.begin({ effect });
      } catch (error) {
        if (isUnsupported(error)) unsupported = true;
        go();
        return;
      }

      busy.phase = 'navigating';
      const landed = nextPageCommit(COMMIT_TIMEOUT_MS);
      go();
      if (!(await landed)) {
        // Nothing navigated (an overlay took the Back): nothing to show.
        await removePicture();
        return;
      }
      await afterPaint();

      busy.phase = 'playing';
      try {
        await PageTransition.play(motion(effect, 'close', snapshot));
      } catch {
        await removePicture();
      }
    } finally {
      busy = null;
    }
  };

  const plain = () => unsupported || prefersReducedMotion();

  return {
    whenIdle() {
      // `current` can be replaced while it runs (a Back picked up as an open
      // lands), so wait until a settle leaves nothing in progress.
      // Each check waits a task, so it can never spin on a settled promise.
      const settle = () => (busy
        ? current.then(() => new Promise((resolve) => setTimeout(resolve, 0))).then(settle, settle)
        : Promise.resolve());
      return settle();
    },

    open(go, { effect: requested } = {}) {
      const effect = pageEffectOrDefault(requested);
      const job = busy;
      if (!job) {
        if (plain()) go();
        else current = runOpen(go, effect);
        return;
      }
      if (job.kind === 'close' && job.phase === 'playing') {
        // A tap on the page coming back: land it now, then open from there.
        current = Promise.all([removePicture(), current]).then(() => {
          if (busy) return undefined;
          if (plain()) {
            go();
            return undefined;
          }
          return runOpen(go, effect);
        });
      }
      // Otherwise a page is already on its way: one navigation at a time.
    },

    close(go, { animate = true, effect: requested = DEFAULT_PAGE_EFFECT } = {}) {
      const effect = pageEffectOrDefault(requested);
      const job = busy;
      if (!job) {
        if (!animate || plain()) go();
        else current = runClose(go, effect);
        return;
      }
      if (job.kind === 'open' && !job.back && job.phase !== 'returning') {
        job.back = go;
        if (job.phase === 'playing') {
          // Turned round natively; `play` then resolves 'reversed'. If it had
          // just landed, the open's end picks the Back up instead.
          PageTransition.reverse().catch(() => {});
        }
      }
      // Otherwise already closing, or already going back: ignored.
    },
  };
}
