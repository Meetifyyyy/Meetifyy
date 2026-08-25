import { useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation, useNavigationType } from 'react-router-dom';
import { overlayManager } from '@shared/services/OverlayManager';
import { createBrowserHistoryMirror, isUsableIdx } from '@shared/lib/navigation/browserHistoryMirror';

/**
 * Back-navigation core.
 *
 * The browser's own history is still the stack the user actually walks — but
 * what goes *onto* it is now decided by a collapsing history stack
 * (`@shared/lib/navigation/collapsingHistoryStack`) rather than by whoever
 * called navigate. The rule it enforces:
 *
 *   - re-entering the page you are already on pushes nothing;
 *   - re-entering a page already in the stack steps BACK onto it and discards
 *     the detour above it;
 *   - only a genuinely new destination pushes.
 *
 * Which is the fix for the bug this module used to have. Every navigation was
 * a push, so toggling between two tabs a hundred times built a hundred-deep
 * stack and escaping it took a hundred Back presses. Now the stack can never
 * hold two entries for the same page, so leaving a stretch of switching costs
 * one press per DISTINCT page touched, however many times the user switched.
 *
 * `SmartBackTracker` reconciles on arrival rather than only at the call site,
 * so a navigation made with a raw `useNavigate` or a `<Link>` is collapsed
 * too: a push that lands on a page already in the stack is walked straight
 * back onto the existing entry. Collapsing is a property of the app, not a
 * feature you get for calling the right helper.
 *
 * Because collapses and Back are both performed as real history steps, the
 * browser Back button, the Android hardware/gesture back, the iOS swipe and
 * `goBack()` are the same operation on the same stack — there is no second,
 * simulated stack that can drift out of step with the first.
 */

const SESSION_KEY = 'smartHistoryStack_v4';

/**
 * Where Back goes when nothing of ours is left behind it (requirement: this is
 * never undefined). On the web, "exit the app" is not ours to perform — the
 * browser owns the entries before the session started — so an exhausted stack
 * lands on the default route instead, and only a further Back, which belongs
 * to the browser, leaves the site. Callers can name a different route per call
 * site via `goBack(fallbackPath)`.
 */
const DEFAULT_ROUTE = '/home';

/**
 * Stretch goal, off by default: treat an uninterrupted stretch of toggling
 * between already-seen pages as one logical step, so a single Back leaves the
 * whole stretch. The shipped guarantee is the weaker, more predictable one —
 * one press per distinct page — because with this on, Home → A → B → A → B
 * puts a single Back at Home rather than at A, which surprises anyone who
 * expects Back to undo the last move. Flip it here to opt the whole app in;
 * the behaviour is covered by tests either way.
 */
const COLLAPSE_TOGGLE_SESSIONS = false;

const mirror = createBrowserHistoryMirror({
  defaultRoute: DEFAULT_ROUTE,
  collapseToggleSessions: COLLAPSE_TOGGLE_SESSIONS,
});

function currentIdx() {
  const idx = typeof window !== 'undefined' ? window.history.state?.idx : null;
  return isUsableIdx(idx) ? idx : null;
}

/**
 * Is the entry we are sitting on one an overlay pushed for Back to eat?
 * Those share their URL with the page beneath them and exist only to be
 * popped, so they must never enter the page stack.
 */
function currentEntryIsOverlay() {
  if (typeof window === 'undefined') return false;
  const state = window.history.state;
  return (state?.usr?.__overlayId ?? state?.__overlayId ?? null) !== null;
}

try {
  const stored = sessionStorage.getItem(SESSION_KEY);
  if (stored) mirror.hydrate(JSON.parse(stored));
} catch (e) {
  /* sessionStorage unavailable (private mode / disabled) — run cacheless */
}

function persist() {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(mirror.snapshot()));
  } catch (e) {
    /* ignore */
  }
}

/**
 * True when `target` is a strict ancestor of `current` -- i.e. navigating to it
 * is a move *up* into a section we are already inside, not a new destination.
 * Matched on a `/` boundary so /messages never matches /messagesX.
 */
export function isAncestorPath(target, current) {
  if (!target || !current || target === '/') return false;
  return current.startsWith(`${target}/`);
}

/**
 * Normalizes a location to the identity we compare entries by.
 *
 * The query string counts. Sub-views that live in the URL (a followers list at
 * `?tab=followers`, an open panel) push an entry whose pathname is identical to
 * the profile behind it; ignoring `search` made those two entries look like
 * duplicates, so Back skipped straight past the profile and closing the list
 * closed the whole page. Incidental filters navigate with `replace` and never
 * create an entry to step over, so nothing is lost by counting them here.
 */
export function getMeaningfulPath(pathname, search = '') {
  return search ? `${pathname}${search.startsWith('?') ? search : `?${search}`}` : pathname;
}

/**
 * The identity a `navigate(to)` argument would land on, or null when it cannot
 * be resolved statically (a relative path, a delta). Callers fall back to a
 * plain navigate in that case rather than guessing.
 */
export function resolveTargetKey(to, location) {
  if (typeof to === 'number') return null;
  if (typeof to === 'string') {
    const withoutHash = to.split('#')[0];
    if (!withoutHash.startsWith('/')) return null;
    const [pathname, search = ''] = withoutHash.split('?');
    return getMeaningfulPath(pathname, search ? `?${search}` : '');
  }
  if (to && typeof to === 'object') {
    const pathname = to.pathname ?? location?.pathname;
    if (!pathname) return null;
    return getMeaningfulPath(pathname, to.search ?? '');
  }
  return null;
}

/**
 * SmartBackTracker — mount once at the router root.
 *
 * Feeds every location change to the mirror and performs whatever step it asks
 * for. `location.key` is in the dependency list on purpose: a push to the URL
 * we are already on changes nothing else about the location, and without it
 * that push — the purest form of the duplicate this module exists to prevent —
 * would slip past unnoticed.
 */
export function SmartBackTracker() {
  const location = useLocation();
  const navType = useNavigationType();
  const navigate = useNavigate();

  useEffect(() => {
    const step = mirror.sync({
      idx: currentIdx(),
      key: getMeaningfulPath(location.pathname, location.search),
      navType,
      isOverlay: currentEntryIsOverlay(),
    });

    persist();

    // A collapse: the browser pushed an entry the stack refused. Stepping back
    // onto the entry that already exists targets the same URL, so nothing
    // visibly re-renders — the user simply ends up on the entry they walked,
    // scroll position and all, instead of a duplicate stacked on top of it.
    if (step?.go) navigate(step.go);
  }, [location.pathname, location.search, location.key, navType, navigate]);

  return null;
}

/**
 * True when there is at least one in-app page behind the current one.
 * Used to decide between a real history step and a synthetic "up" navigation.
 */
export function canGoBackInApp() {
  return mirror.canGoBack(currentIdx());
}

/** Test/debug seam: the page stack as the app currently sees it. */
export function debugHistoryStack() {
  return mirror.stack.keys();
}

/**
 * Centralized navigation hook.
 *
 *  - `goBack(fallbackPath, options)` — dismisses an open overlay, otherwise
 *    steps back to the previous *distinct* page, otherwise navigates to
 *    `fallbackPath`.
 *  - `smartNavigate(to, options)` — `navigate` that collapses instead of
 *    pushing when the target is a page already in the stack.
 */
export function useSmartNavigation() {
  const navigate = useNavigate();
  const location = useLocation();
  const isNavigating = useRef(false);

  const goBack = useCallback(
    (fallbackPath = DEFAULT_ROUTE, options = { replace: true }) => {
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
      //    whether it comes from the browser chrome, the hardware key, the iOS
      //    swipe or an in-app back button: all of them move the same stack.
      //    The mirror is not mutated here — the resulting POP comes back
      //    through SmartBackTracker, which is the only place the stack is
      //    allowed to shrink, so the two can never disagree.
      const plan = mirror.planBack({ idx: currentIdx(), fallbackRoute: fallbackPath });
      if (plan.go) {
        navigate(plan.go);
        return;
      }

      // 4. Nothing of ours behind us — a deep link, a new tab, or a reload at
      //    the session's first entry. Go to the fallback instead, replacing so
      //    we don't grow a stack the user never walked. Already there? Stay
      //    put: the next Back is the browser's, and leaves the app.
      const route = plan.route || fallbackPath;
      if (location.pathname === route) return;
      navigate(route, { replace: true, ...options });
    },
    [navigate, location.pathname]
  );

  const smartNavigate = useCallback(
    (to, options = {}) => {
      const currentKey = getMeaningfulPath(location.pathname, location.search);
      const targetKey = resolveTargetKey(to, location);
      const target = typeof to === 'string' ? to : to?.pathname || '';
      const targetPath = target.split('?')[0].split('#')[0];

      if (targetKey && !options.replace) {
        // Re-navigating to the page we're already on must never grow history.
        // Replacing rather than returning early keeps any `state` the caller
        // passed, while still leaving the stack exactly as deep as it was.
        if (targetKey === currentKey) {
          navigate(to, { ...options, replace: true });
          return;
        }

        // Already somewhere in the stack: step back onto that entry and drop
        // the detour above it. This is the whole fix — it is why toggling
        // between two tabs stays two entries deep instead of two hundred, and
        // why the entry the user returns to keeps its scroll position.
        const collapse = mirror.planCollapse({ idx: currentIdx(), key: targetKey });
        if (collapse?.go) {
          navigate(collapse.go);
          return;
        }
      }

      // Same page (ignoring the query) or a move *up* into a section we are
      // already inside — tapping "Messages" while a chat is open is a return
      // to the tab root, not a new destination. Neither should push: replacing
      // discards the child entry instead, so Back from a tab root leaves the
      // section rather than re-opening the chat the user just closed.
      const isSamePage = targetPath === location.pathname;
      const isAncestorOfCurrent = isAncestorPath(targetPath, location.pathname);
      const shouldReplace = options.replace || isSamePage || isAncestorOfCurrent;

      navigate(to, { ...options, replace: shouldReplace });
    },
    [navigate, location]
  );

  return {
    goBack,
    smartNavigate,
    navigate: smartNavigate,
  };
}
