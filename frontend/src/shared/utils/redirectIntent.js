const KEY = 'postAuthRedirect';

// Auth screens are never a destination worth returning to — bouncing back into
// one after signing in would loop the user straight out of the app again.
// True from the moment a signed-in session ends in this document until the next
// sign-in. See `suppressRedirectIntent`.
let suppressed = false;

const NON_DESTINATIONS = ['/', '/login', '/signup', '/forgot-password', '/reset-password'];

/**
 * Only same-origin, absolute in-app paths are accepted. A value starting with
 * `//` or containing a scheme would be an open redirect once handed to
 * `navigate`, so it is rejected outright.
 */
function isSafeInAppPath(path) {
  if (typeof path !== 'string') return false;
  if (!path.startsWith('/') || path.startsWith('//')) return false;
  if (/^\/\\/.test(path)) return false;
  const pathname = path.split('?')[0].split('#')[0];
  return !NON_DESTINATIONS.includes(pathname);
}

/**
 * Remembers where an unauthenticated visitor was actually trying to go, so the
 * deep link survives the trip through the landing and login screens. Kept in
 * sessionStorage rather than history state because the user walks through
 * several routes (landing -> login -> back) before it is needed, and history
 * state does not survive that.
 */
export function setRedirectIntent(path) {
  if (suppressed || !isSafeInAppPath(path)) return;
  try {
    sessionStorage.setItem(KEY, path);
  } catch (e) {
    /* ignore */
  }
}

/** Reads and clears the stored destination. Returns null when there isn't one. */
export function consumeRedirectIntent() {
  try {
    const value = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return isSafeInAppPath(value) ? value : null;
  } catch (e) {
    return null;
  }
}

export function clearRedirectIntent() {
  try {
    sessionStorage.removeItem(KEY);
  } catch (e) {
    /* ignore */
  }
}

/**
 * A session that ENDS is not a visitor asking for a page.
 *
 * Signing out of Settings leaves the app mounted on /settings with nobody
 * signed in, and the protected-route guard cannot tell that apart from a
 * stranger opening a shared link: it recorded /settings as "where they were
 * trying to go", and the next sign-in - the same account or another - landed
 * there instead of on Home. The deep-link return is for people who arrive signed
 * out; after a sign-out nothing is recorded until the next sign-in, and anything
 * already stored is dropped.
 */
export function suppressRedirectIntent() {
  suppressed = true;
  clearRedirectIntent();
}

/** A sign-in happened: later signed-out visits are visits again. */
export function allowRedirectIntent() {
  suppressed = false;
}
