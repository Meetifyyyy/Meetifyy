/**
 * Browser storage, wrapped so the code above it does not have to know it is a
 * browser.
 *
 * Every accessor here can throw: storage is blocked in private browsing, it can
 * be disabled by policy, and a quota failure surfaces on write. That is why
 * each one is individually guarded and each one has a defined answer when it
 * fails — a missing value, never an exception. Code that reads a preference
 * should not be the code that has to know Safari exists.
 *
 * Synchronous on purpose: see `SyncKeyValueStore` in ../contracts.ts. These sit
 * in the request hot path, and a native implementation keeps them synchronous
 * by hydrating a Map at startup rather than by making the caller await.
 */

/** @param {Storage|undefined} backing */
function createSyncStore(backing) {
  return {
    get(key) {
      try {
        return backing?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        backing?.setItem(key, value);
      } catch {
        // Disabled storage or a full quota. The value is a cache or a hint in
        // every case this is used for, so losing it costs a round trip, never
        // correctness.
      }
    },
    remove(key) {
      try {
        backing?.removeItem(key);
      } catch {
        // Nothing was written, so nothing needs removing.
      }
    },
    /**
     * Removes only what this app wrote.
     *
     * Deliberately not `backing.clear()`: on a shared origin that would throw
     * away other things too, and on logout the intent is "drop this session's
     * shadow", not "empty the browser".
     */
    clearPrefixed(prefix) {
      try {
        if (!backing) return;
        const doomed = [];
        for (let i = 0; i < backing.length; i++) {
          const key = backing.key(i);
          if (key && key.startsWith(prefix)) doomed.push(key);
        }
        doomed.forEach((key) => backing.removeItem(key));
      } catch {
        // As above.
      }
    },
  };
}

const safeWindow = () => (typeof window === 'undefined' ? undefined : window);

export const createWebSessionStore = () => createSyncStore(safeWindow()?.sessionStorage);
export const createWebLocalStore = () => createSyncStore(safeWindow()?.localStorage);

/**
 * Reads the readable half of the session cookie pair.
 *
 * `<prefix>_csrf` is not HttpOnly on purpose — the double-submit check depends on the
 * page being able to echo it back — and the HttpOnly cookies beside it are
 * unreachable from here, which is the point.
 *
 * This is only ever a FALLBACK. `document.cookie` shows a page the cookies of
 * its own document, and the API is routinely on a different hostname, so unless
 * the cookie is scoped to the registrable domain this returns an empty string
 * on a perfectly healthy session. Every response that issues the cookies also
 * returns the token in its body, and that is what the header is normally built
 * from.
 *
 * A native client has no equivalent and supplies a reader that returns ''.
 */
export function createWebCookieReader({ cookiePrefix = 'mf' } = {}) {
  // Matches the server's COOKIE_NAME_PREFIX. Development and production share
  // `.meetifyy.app`, so the dev page can see production's `mf_csrf` as well as
  // its own `mf_dev_csrf`, and must read only the one its API issued.
  const pattern = new RegExp(`(?:^|;\\s*)${cookiePrefix}_csrf=([^;]+)`);
  return {
    readCsrf() {
      try {
        if (typeof document === 'undefined') return '';
        const match = document.cookie.match(pattern);
        return match ? decodeURIComponent(match[1]) : '';
      } catch {
        return '';
      }
    },
  };
}

/**
 * The transport's notifications, delivered as DOM events.
 *
 * The web app already listens for these on `window`, so this keeps that working
 * unchanged while removing `window.dispatchEvent` from the transport itself. A
 * native client passes callbacks that do something else entirely.
 */
export function createWebTransportHooks({ onApiErrorCode } = {}) {
  const emit = (name) => {
    try {
      safeWindow()?.dispatchEvent(new Event(name));
    } catch {
      // No window, or an environment without Event. Nothing to notify.
    }
  };
  return {
    onApiErrorCode,
    onUnauthorized: () => emit('auth:unauthorized'),
    onOriginChanged: () => emit('api:origin-changed'),
  };
}
