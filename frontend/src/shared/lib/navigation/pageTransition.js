/**
 * How a page opens over the page it was opened from, and closes back onto it.
 *
 * THE EFFECTS
 * Two, each in its own file, each drawn natively by an effect of the same name:
 *   'slide'   slideTransition.js   the new page slides in from the right edge
 *                                  over the current one, which drifts left and
 *                                  dims (SlidePageEffect.java). The default.
 *   'centre'  centreTransition.js  the new page opens out of the middle of the
 *                                  screen, scaling down to size as it fades in,
 *                                  while the page beneath shrinks away
 *                                  (CentrePageEffect.java).
 * Closing is the same motion played the other way. Every number is in the
 * effect's own file, so every page that uses an effect moves identically.
 *
 * WHO DRAWS IT
 * A driver, installed at startup (`setPageTransitionDriver`). Only the
 * installed app has one (platform/capacitor/pageTransition.js, from
 * mobile/main.jsx). With no driver, which is the website, `openPage` and
 * `closePage` simply run the navigation, synchronously, exactly as before.
 *
 * HOW A PAGE OPTS IN
 *  - Open it with `usePageTransition().open(to, options, { effect })`. That
 *    navigates with the motion and marks the new history entry
 *    (`withPageTransition`) with the effect it opened with; `effect` is left
 *    out for the default.
 *  - Closing needs nothing more. Back from a marked entry closes with the same
 *    effect however it is asked for: the page's own back button
 *    (useSmartNavigation's goBack) or Android's back (mobile/main.jsx). Back
 *    from an entry that was not opened this way stays a plain navigation, so a
 *    page opened from somewhere else is unaffected.
 *
 * Driver contract:
 *   driver.open(go, { effect })     `go()` performs the navigation
 *   driver.close(go, { animate, effect })
 *                                   `go()` performs the Back; `animate` is
 *                                   false when the entry was not opened with
 *                                   a motion. The driver still sees it, so a
 *                                   Back pressed while a page is moving can be
 *                                   folded into that motion instead of
 *                                   changing the page under it.
 *   driver.whenIdle()               resolves once no page is moving
 *   A driver calls `go()` at most once, and may decide not to call it at all
 *   when the request is overtaken (Back pressed before an open has started).
 *   It waits for the navigation to reach the screen through
 *   `nextPageCommit()`, which the app's router root reports to.
 */

import { CENTRE_EFFECT, centrePlayArgs, measureFadeEarly } from './centreTransition';
import { SLIDE_EFFECT, slidePlayArgs } from './slideTransition';

/**
 * Each effect's name, what the shell is told to play for it, and (for an effect
 * that needs to know something about the page it is leaving) what to ask the
 * page as it is pictured, which is handed to `play`.
 */
const EFFECTS = Object.freeze({
  [SLIDE_EFFECT]: Object.freeze({ play: slidePlayArgs }),
  [CENTRE_EFFECT]: Object.freeze({ play: centrePlayArgs, snapshot: measureFadeEarly }),
});

/** What a page gets when it does not ask for one. */
export const DEFAULT_PAGE_EFFECT = SLIDE_EFFECT;

export function isPageEffect(value) {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(EFFECTS, value);
}

/** `value` if it names an effect, else the default: never throws on a stale or unknown name. */
export function pageEffectOrDefault(value) {
  return isPageEffect(value) ? value : DEFAULT_PAGE_EFFECT;
}

/**
 * What to ask the page being left, just before it is pictured, for `effect`:
 * the part of it the effect needs to draw differently (the centre opening's
 * early-fading elements). Null for an effect that needs nothing.
 */
export function pageEffectSnapshot(effect) {
  return EFFECTS[pageEffectOrDefault(effect)].snapshot?.() ?? null;
}

/**
 * What the shell's `play` is given for `effect` going `direction` ('open' |
 * 'close'); `snapshot` is what `pageEffectSnapshot` returned for this page.
 */
export function pageEffectPlayArgs(effect, direction, dark, snapshot = null) {
  return EFFECTS[pageEffectOrDefault(effect)].play(direction, dark, snapshot);
}

/** The history-state key that marks an entry opened with the motion. */
export const PAGE_TRANSITION_STATE_KEY = '__pageTransition';

let driver = null;

export function setPageTransitionDriver(next) {
  driver = next || null;
}

export function hasPageTransitionDriver() {
  return driver !== null;
}

/**
 * Router state for an entry opened with an effect. Unchanged without a
 * driver, so the website's history entries are exactly what they were.
 */
export function withPageTransition(state, effect = DEFAULT_PAGE_EFFECT) {
  if (!driver) return state;
  return {
    ...(state && typeof state === 'object' ? state : {}),
    [PAGE_TRANSITION_STATE_KEY]: pageEffectOrDefault(effect),
  };
}

/**
 * The mark alone, for a page that rewrites its own entry on arrival (a
 * `replace` that clears a one-shot flag): passing this as the new state keeps
 * the page closing with the motion. Null when the entry was not marked.
 */
export function keepPageTransition(state) {
  return state?.[PAGE_TRANSITION_STATE_KEY] ? { [PAGE_TRANSITION_STATE_KEY]: state[PAGE_TRANSITION_STATE_KEY] } : null;
}

/**
 * Runs `fn` once no page is moving: at once without a driver or when idle.
 * For work that must not happen mid-motion, such as focusing a field, which
 * raises the keyboard and resizes the page while it slides.
 */
export function afterPageTransition(fn) {
  if (!driver?.whenIdle) {
    fn();
    return;
  }
  driver.whenIdle().then(fn, fn);
}

/**
 * The effect this history entry was opened with, or null if it was not opened
 * with one.
 *
 * React Router keeps the state a page was navigated with under `usr`. An
 * overlay's entry (a sheet or viewer pushed so Back dismisses it) is never a
 * page: it carries only its `__overlayId`, and Back there closes the overlay.
 */
export function pageEffectOfEntry(historyState) {
  if (!historyState || typeof historyState !== 'object') return null;
  const usr = historyState.usr;
  if (historyState.__overlayId != null || usr?.__overlayId != null) return null;
  const mark = usr?.[PAGE_TRANSITION_STATE_KEY];
  return isPageEffect(mark) ? mark : null;
}

/** Was this history entry opened with a motion? */
export function entryOpenedWithTransition(historyState) {
  return pageEffectOfEntry(historyState) !== null;
}

/** Opens a page with `effect`; `go()` performs the navigation. */
export function openPage(go, effect = DEFAULT_PAGE_EFFECT) {
  if (!driver) {
    go();
    return;
  }
  driver.open(go, { effect: pageEffectOrDefault(effect) });
}

/**
 * Steps Back; `go()` performs it. With the effect the entry being left was
 * opened with, when it was opened with one.
 */
export function closePage(go, historyState = currentHistoryState()) {
  if (!driver) {
    go();
    return;
  }
  const effect = pageEffectOfEntry(historyState);
  driver.close(go, { animate: effect !== null, effect: effect ?? DEFAULT_PAGE_EFFECT });
}

function currentHistoryState() {
  return typeof window !== 'undefined' ? window.history.state : null;
}

// ── Commits ────────────────────────────────────────────────────────────────

const commitListeners = new Set();

/**
 * Reported by the router root, in a layout effect, whenever the location
 * changes: the new page's DOM is in place and has not been painted yet.
 */
export function notifyPageCommitted() {
  for (const listener of [...commitListeners]) listener();
}

/**
 * The next location change to reach the DOM. Resolves true when it does, or
 * false if none has within `timeoutMs` (the navigation was refused, or an
 * overlay took the Back instead). Ask before calling `go()`.
 */
export function nextPageCommit(timeoutMs) {
  return new Promise((resolve) => {
    let timer = null;
    const listener = () => {
      clearTimeout(timer);
      commitListeners.delete(listener);
      resolve(true);
    };
    commitListeners.add(listener);
    timer = setTimeout(() => {
      commitListeners.delete(listener);
      resolve(false);
    }, timeoutMs);
  });
}
