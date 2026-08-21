import { useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation, useNavigationType } from 'react-router-dom';
import { overlayManager } from '@shared/services/OverlayManager';

/**
 * Back-navigation core.
 *
 * The browser's own history is the single source of truth. React Router stamps
 * every entry it creates with a monotonic `history.state.idx`; this module only
 * keeps a *label cache* (idx -> path) so `goBack` can tell whether the entry
 * behind us is a different page or a duplicate of the current one. The cache is
 * never consulted to decide *whether* we can go back — that comes from `idx`
 * alone — so a stale or missing cache degrades to correct-but-dumber behaviour
 * instead of the desynced stack the previous implementation could produce.
 */

const SESSION_KEY = 'smartHistoryEntries_v3';
const ORIGIN_KEY = 'smartHistoryOrigin_v3';

const _state = {
  // Sparse array of path strings, indexed by history.state.idx.
  entries: [],
  // The idx this SPA session started at. Anything at or below it belongs to
  // whatever the user was doing before the app loaded (another site, a fresh
  // tab), so Back from there must leave the app rather than be simulated.
  originIdx: null,
};

function currentIdx() {
  const idx = window.history.state?.idx;
  // `typeof NaN === 'number'`, and a negative or fractional idx is equally
  // unusable: both reach `_state.entries.length = idx` below, which throws
  // RangeError: Invalid array length and takes out the root error boundary.
  // Only a real, non-negative array index counts as usable here.
  return Number.isSafeInteger(idx) && idx >= 0 ? idx : null;
}

try {
  const storedEntries = sessionStorage.getItem(SESSION_KEY);
  if (storedEntries) {
    const parsed = JSON.parse(storedEntries);
    if (Array.isArray(parsed)) _state.entries = parsed;
  }
  const storedOrigin = sessionStorage.getItem(ORIGIN_KEY);
  if (storedOrigin !== null) {
    const parsed = Number(storedOrigin);
    if (Number.isFinite(parsed)) _state.originIdx = parsed;
  }
} catch (e) {
  /* sessionStorage unavailable (private mode / disabled) — run cacheless */
}

function persist() {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(_state.entries));
    if (_state.originIdx !== null) {
      sessionStorage.setItem(ORIGIN_KEY, String(_state.originIdx));
    }
  } catch (e) {
    /* ignore */
  }
}

/**
 * Normalizes a location to the identity we compare entries by. Query strings
 * are deliberately excluded: `/crew?tab=saved` and `/crew?tab=hosting` are the
 * same page, and Back between them should still land on the previous *page*.
 */
export function getMeaningfulPath(pathname, search = '') {
  return pathname;
}

/**
 * SmartBackTracker — mount once at the router root.
 *
 * Records the path at each history index. Because entries are keyed by the
 * router's own idx rather than pushed/popped in parallel, PUSH/POP/REPLACE all
 * self-correct: a POP simply reads the idx it landed on, and a forward
 * navigation after a POP truncates the entries the browser itself discarded.
 */
export function SmartBackTracker() {
  const location = useLocation();
  const navType = useNavigationType();

  useEffect(() => {
    const path = getMeaningfulPath(location.pathname, location.search);
    const idx = currentIdx();

    if (idx === null) {
      // No router-managed history state (very old browsers, or an entry pushed
      // outside the router). Nothing reliable to key on; leave the cache alone.
      return;
    }

    if (_state.originIdx === null) {
      _state.originIdx = idx;
    } else if (idx < _state.originIdx) {
      // The user went back past where this session started (possible when the
      // tab was restored). Re-anchor so we never simulate Back into entries we
      // know nothing about.
      _state.originIdx = idx;
    }

    if (navType === 'PUSH') {
      // A push invalidates every forward entry the browser just discarded.
      _state.entries.length = idx;
    }
    _state.entries[idx] = path;

    persist();
  }, [location.pathname, location.search, navType]);

  return null;
}

/**
 * True when there is at least one in-app history entry behind the current one.
 * Used to decide between a real `navigate(-1)` and a synthetic "up" navigation.
 */
export function canGoBackInApp() {
  const idx = currentIdx();
  if (idx === null) return false;
  const origin = _state.originIdx ?? 0;
  return idx > origin;
}

/**
 * Number of history steps back to the nearest entry whose path differs from the
 * current one, or null when there is no such entry within this app session.
 * Guards against the duplicate entries that repeated same-path pushes can leave
 * behind, so one Back press never appears to do nothing.
 */
function stepsToPreviousDistinctEntry(currentPath) {
  const idx = currentIdx();
  if (idx === null) return null;
  const origin = _state.originIdx ?? 0;

  let target = idx - 1;
  while (target >= origin && _state.entries[target] === currentPath) {
    target -= 1;
  }
  if (target < origin) return null;
  // An unknown (never-cached) entry is still a real entry — stepping to it is
  // correct; we just can't say what it was.
  return idx - target;
}

/**
 * Centralized navigation hook.
 *
 *  - `goBack(fallbackPath, options)` — dismisses an open overlay, otherwise
 *    pops the real history stack, otherwise navigates up to `fallbackPath`.
 *  - `smartNavigate(to, options)` — `navigate` that replaces instead of pushing
 *    when the target is the page we are already on.
 */
export function useSmartNavigation() {
  const navigate = useNavigate();
  const location = useLocation();
  const isNavigating = useRef(false);

  const goBack = useCallback(
    (fallbackPath = '/home', options = { replace: true }) => {
      // 1. An open overlay owns Back before the route does.
      if (overlayManager.hasOpenOverlays()) {
        overlayManager.closeTop();
        return;
      }

      // 2. Debounce double taps.
      if (isNavigating.current) return;
      isNavigating.current = true;
      setTimeout(() => {
        isNavigating.current = false;
      }, 350);

      // 3. Real history first. This is what makes Back behave identically
      //    whether it comes from the browser chrome, the hardware key, or an
      //    in-app back button: all three pop the same stack.
      if (canGoBackInApp()) {
        const steps = stepsToPreviousDistinctEntry(
          getMeaningfulPath(location.pathname, location.search)
        );
        if (steps) {
          navigate(-steps);
          return;
        }
      }

      // 4. No in-app history behind us — this is a deep link, a new tab, or a
      //    reload at the session's first entry. Navigate *up* to the parent
      //    instead, replacing so we don't grow a stack the user never walked.
      if (location.pathname === fallbackPath) return;
      navigate(fallbackPath, { replace: true, ...options });
    },
    [navigate, location.pathname, location.search]
  );

  const smartNavigate = useCallback(
    (to, options = {}) => {
      const target = typeof to === 'string' ? to : to?.pathname || '';
      const targetPath = target.split('?')[0].split('#')[0];

      // Re-navigating to the page we're already on should never grow history.
      const shouldReplace = options.replace || targetPath === location.pathname;

      navigate(to, { ...options, replace: shouldReplace });
    },
    [navigate, location.pathname]
  );

  return {
    goBack,
    smartNavigate,
    navigate: smartNavigate,
  };
}
