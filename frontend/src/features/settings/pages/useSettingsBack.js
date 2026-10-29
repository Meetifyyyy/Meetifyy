import { useEffect } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { useSmartBack } from '@shared/hooks/useSmartBack';
import { canGoBackInApp } from '@shared/hooks/useSmartNavigation';

/**
 * Where each history entry inside Settings was opened FROM, when that was
 * another Settings page.
 *
 * Keyed by the router's per-entry key, which the browser keeps for the life of
 * the entry (a POP restores it, a reload keeps it). The page below an entry
 * can never change while the entry exists — changing it means popping to it and
 * pushing, which discards this entry — so a record made when the entry was
 * pushed stays true for as long as anyone can land on it. That is what lets
 * Back trust it without seeing the browser's stack.
 *
 * Recorded for every way in, not only this module's own calls: a row, a FAQ
 * link inside Help, a Help tile, a modal's "View requests". Anything that
 * pushes one Settings URL on top of another.
 */
const STORAGE_KEY = 'settingsOpenedFrom_v1';
const MAX_RECORDS = 50;
const openedFrom = new Map();
/** The Settings entry on screen right now, or null once Settings is left. */
let lastSeen = null;

try {
  const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]');
  if (Array.isArray(stored)) {
    for (const pair of stored) {
      if (Array.isArray(pair) && typeof pair[0] === 'string' && typeof pair[1] === 'string') {
        openedFrom.set(pair[0], pair[1]);
      }
    }
  }
} catch {
  /* sessionStorage unavailable or corrupt: run without, Back walks the tree */
}

function persist() {
  while (openedFrom.size > MAX_RECORDS) openedFrom.delete(openedFrom.keys().next().value);
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...openedFrom]));
  } catch {
    /* ignore */
  }
}

export function isSettingsPath(path) {
  return typeof path === 'string' && (path === '/settings' || path.startsWith('/settings/') || path.startsWith('/settings?'));
}

function historyState() {
  return typeof window !== 'undefined' ? window.history.state : null;
}

/** An entry an overlay pushed for Back to eat. Shares the page's URL; not a page. */
function isOverlayEntry(state) {
  return (state?.usr?.__overlayId ?? state?.__overlayId ?? null) !== null;
}

/**
 * Note an arrival on a Settings page. Exported for tests; the hook calls it.
 *
 * @param {{ key: string, path: string, navType: 'PUSH'|'REPLACE'|'POP', idx?: number|null, overlay?: boolean }} arrival
 */
export function recordSettingsArrival({ key, path, navType, idx = null, overlay = false }) {
  if (!key || overlay) return;
  const prev = lastSeen;
  // Pushed from the Settings page that was on screen: that page is right behind.
  // The index check is a second witness, so a stale `lastSeen` cannot vouch for
  // an entry it never sat under.
  const adjacent = prev && (!Number.isInteger(idx) || !Number.isInteger(prev.idx) || prev.idx === idx - 1);
  if (navType === 'PUSH' && prev && prev.key !== key && adjacent) {
    openedFrom.set(key, prev.path);
    persist();
  } else if (navType === 'REPLACE' && prev && prev.key !== key && openedFrom.has(prev.key)) {
    // A replace keeps the page below, so it keeps what that page was.
    openedFrom.set(key, openedFrom.get(prev.key));
    persist();
  }
  lastSeen = { key, path, idx: Number.isInteger(idx) ? idx : null };
}

/** Settings was left for a page outside it. */
export function noteSettingsLeft() {
  lastSeen = null;
}

/** The Settings page right behind the entry `key`, or null when it is not one. */
export function settingsPageBehind(key) {
  const from = key ? openedFrom.get(key) : null;
  return isSettingsPath(from) ? from : null;
}

/** Test seam: forget everything. */
export function resetSettingsTrail() {
  openedFrom.clear();
  lastSeen = null;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * The logical page above the one open: a Help sub-view's hub, a panel's
 * category (or the root, for a panel that sits on the root), a category's root.
 * Null at the root, whose Back leaves Settings.
 */
export function settingsParentPath({ activePanel, activeCategory, subView = null, parentOf }) {
  if (activePanel) {
    if (subView) return `/settings/${activePanel}`;
    const parent = parentOf(activePanel);
    return parent ? `/settings/${parent}` : '/settings';
  }
  if (activeCategory) return '/settings';
  return null;
}

/**
 * Back for the Settings pages.
 *
 * @param {object}   args
 * @param {string|null} args.activePanel      the open panel's slug, or null
 * @param {string|null} args.activeCategory   the open category's slug, or null
 * @param {string|null} [args.subView]        a `?view=` sub-view of the panel (Help's requests / safety)
 * @param {(panel: string) => string|null} args.parentOf  a panel's category
 * @param {boolean}  args.isLargeScreen       the split (desktop) layout
 *
 * BACK RETURNS TO THE PAGE THE USER ACTUALLY CAME FROM.
 *
 * It used to move up the tree with a navigation, and on a phone that looped.
 * Moving up went through `smartNavigate`, which PUSHES when the parent is not
 * already behind — true for any panel opened other than from its own category:
 * from another category, from the Privacy panel, from a link or a
 * notification. The Settings root then replaced itself on top of the stranded
 * panel, so from the root Back popped straight into that panel, whose Back
 * pushed its parent again, round and round:
 *
 *     [home, blocked] → [home, blocked, privacy] → [home, blocked, settings]
 *                     → pop → [home, blocked] → …
 *
 * Now Back is a real history pop whenever the right page is behind, and a pop
 * only ever shrinks the stack. Otherwise it goes up the tree by REPLACING the
 * current entry, so the way out never grows the stack either. Neither step can
 * revisit a page already left, so no sequence of presses can cycle.
 *
 * Which page counts as "behind":
 *  - another Settings page this entry was opened from, on any layout. A FAQ
 *    link in Help, or a Help tile, returns to Help rather than to the root.
 *  - on a phone, any page of ours: each level is its own screen, so Back is
 *    the system's Back (a panel opened from a profile returns to the profile).
 *  - on the desktop split, only Settings pages. It shows the tree beside the
 *    detail, so arriving from elsewhere, Back still means "up the tree".
 */
export function useSettingsBack({ activePanel, activeCategory, subView = null, parentOf, isLargeScreen }) {
  const navigate = useNavigate();
  const goBack = useSmartBack();
  const location = useLocation();
  const navType = useNavigationType();

  useEffect(() => {
    const state = historyState();
    recordSettingsArrival({
      key: location.key,
      path: `${location.pathname}${location.search}`,
      navType,
      idx: state?.idx ?? null,
      overlay: isOverlayEntry(state),
    });
  }, [location.key, location.pathname, location.search, navType]);

  // Leaving Settings ends the trail: the next page pushed is not "from" here.
  // By the time an unmount runs, the browser is already on the new URL.
  useEffect(() => () => {
    if (typeof window !== 'undefined' && !isSettingsPath(window.location.pathname)) noteSettingsLeft();
  }, []);

  const leaveTo = (target) => {
    // Read at press time, not from this render: a confirmation dialog in
    // between leaves the closure pointing at its own history entry.
    const key = historyState()?.key ?? location.key;
    if (settingsPageBehind(key) && canGoBackInApp()) return goBack(target);
    if (!isLargeScreen && canGoBackInApp()) return goBack(target);
    return navigate(target, { replace: true });
  };

  /** The header's back button. Leaving the root leaves Settings. */
  const goUp = () => {
    const parent = settingsParentPath({ activePanel, activeCategory, subView, parentOf });
    if (parent) return leaveTo(parent);
    return goBack('/home');
  };

  return { goUp };
}

export default useSettingsBack;
