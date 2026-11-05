import { useSyncExternalStore } from 'react';

/**
 * The visible half of signing out: a "Logging out" card over the page, held
 * until the signed-out screen has painted underneath it.
 *
 * Signing out used to swap the signed-in tree for the landing page in one
 * commit: the dashboard re-rendered without a user for a frame, the landing (or
 * login) chunk was fetched only then, and what showed in between was a blank
 * Suspense fallback. Now:
 *
 *   covering    the cover fades in over the page that is still there
 *   clearing    AuthContext tears the session down and empties every cache
 *               (under the cover, so no half-signed-out frame is ever seen)
 *   navigating  SignOutOverlay goes to `target` and waits for that page to say
 *               it has painted (`markSignOutDestinationReady`)
 *   revealing   the cover fades out over the signed-out page
 *   idle
 *
 * No React state of its own: a tiny external store, because AuthProvider sits
 * outside the router and the overlay inside it, and both need it.
 */

const COVER_FADE_MS = 160;

let state = { phase: 'idle', target: '/', destinationReady: false, startedAt: 0 };
const listeners = new Set();

function set(patch) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSignOutState() {
  return state;
}

export function useSignOutState() {
  return useSyncExternalStore(subscribe, getSignOutState, getSignOutState);
}

export function isSigningOut() {
  return state.phase !== 'idle';
}

/**
 * Puts the cover up. Resolves once it is opaque, so nothing torn down after
 * this can be seen.
 */
export function beginSignOut() {
  set({ phase: 'covering', destinationReady: false, startedAt: Date.now() });
  return new Promise((resolve) => {
    const done = () => {
      if (state.phase === 'covering') set({ phase: 'clearing' });
      resolve();
    };
    // Two frames so the cover is committed and painted, then the fade itself.
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, COVER_FADE_MS)));
    } else {
      setTimeout(done, COVER_FADE_MS);
    }
  });
}

/** The session is gone and the caches are empty: go to `target`. */
export function signOutCleared(target) {
  set({ phase: 'navigating', target });
}

/**
 * Called by the signed-out screens (landing, login) once they have painted.
 * Harmless at any other time.
 */
export function markSignOutDestinationReady() {
  if (state.phase === 'navigating' && !state.destinationReady) set({ destinationReady: true });
}

export function startSignOutReveal() {
  if (state.phase === 'navigating') set({ phase: 'revealing' });
}

export function endSignOut() {
  set({ phase: 'idle', destinationReady: false });
}

export const SIGN_OUT_COVER_FADE_MS = COVER_FADE_MS;
