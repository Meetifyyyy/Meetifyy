import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  usersApi,
  apiClient,
  authApi,
  postsApi,
  getBackendUrl,
  rememberCsrfToken,
  forgetCsrfToken,
  mayHaveCookieSession,
} from '@shared/api/apiClient';
import { useSavedPostsStore } from '../stores/savedPostsStore';
import { useSavedActivitiesStore } from '../stores/savedActivitiesStore';
import usePostStore from '../stores/postStore';
import { getCollegeName } from '@shared/utils/user';
import { idbClearAll } from '@shared/lib/idb';
import { useQueryClient } from '@tanstack/react-query';
import { propagateUserMedia } from '@shared/utils/propagateUserMedia';

import { supabase, isSupabaseConfigured } from '@shared/lib/supabase';
import { describeNetworkError, logNetworkFailure } from '@shared/utils/networkErrors';
export { supabase, isSupabaseConfigured };

/**
 * How long to wait for signup before calling it failed.
 *
 * Supabase sends the confirmation email inside the signup request itself
 * (`mailer_autoconfirm: false`), so this call is only as fast as the mail
 * provider behind it — and since signup is now proxied, our backend is waiting
 * on that same provider before it can answer. The browser's own timeout is
 * minutes, which on a stalled provider leaves the user staring at a spinner
 * with no idea whether their account was created. Twenty-five seconds is far
 * longer than a healthy signup (measured: well under a second to reach the
 * server) and short enough to fail honestly.
 */
const SIGNUP_TIMEOUT_MS = 25_000;

/**
 * The host signup actually talks to, named in errors so a failure is traceable.
 *
 * This is our API, not Supabase, since signup was moved behind
 * `POST /api/auth/signup` — the backend is the only place a per-IP and
 * per-address budget can be enforced on a call that sends mail. Resolved
 * lazily because `getBackendUrl()` can change origin at runtime: the client
 * fails over to a same-origin proxy prefix on campus networks that blocklist
 * the API's own hostname, and an error naming the wrong host sends whoever
 * reads it to the wrong system.
 */
const signupHost = () => {
  try {
    return new URL(getBackendUrl(), window.location.origin).host;
  } catch {
    return '';
  }
};

/**
 * Rejects with a TimeoutError if the promise has not settled in time.
 *
 * Deliberately not a retry: retrying a signup that may already have created an
 * account is how people end up with duplicates and two confirmation emails. The
 * point is to stop waiting and say so.
 */
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error(`Timed out after ${Math.round(ms / 1000)}s`);
      err.name = 'TimeoutError';
      reject(err);
    }, ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

const AuthContext = createContext(null);

/**
 * The three states a boot can be in, and the only three.
 *
 * `initializing` is not "loading data" — it is "we do not yet know whether
 * anybody is signed in". Nothing may route on that question until it is
 * answered, which is the whole reason this is an explicit value rather than a
 * boolean that several code paths each felt entitled to clear.
 *
 * What it replaces: a `loading` flag that the provider's auth listener set to
 * false the moment it saw an `INITIAL_SESSION` event. That event fires with a
 * null session on every reload, because the provider session lives in memory
 * and memory is empty after a reload — so `loading` went false while the
 * cookie probe was still in flight, `isLoggedIn` was still false, and the
 * router did the only thing it could with the answer it was given: it rendered
 * the landing page. A few hundred milliseconds later the probe came back, the
 * session appeared, and the app redirected to /home. That is the flash of
 * landing page on refresh, and it is also why signing in looked like it had
 * immediately signed the user out again.
 */
export const AUTH_STATUS = Object.freeze({
  INITIALIZING: 'initializing',
  AUTHENTICATED: 'authenticated',
  UNAUTHENTICATED: 'unauthenticated',
});

/** Set while a recovery link owns this tab; the reset page handles it alone. */
function isRecoveryPending() {
  try {
    return sessionStorage.getItem('sb-pwreset-pending') === '1';
  } catch {
    return false;
  }
}

/**
 * Everything a previous user could have left behind in this browser.
 *
 * Listed in one place and used by every exit path — sign-out, a session the
 * server has refused, and a boot that finds a different account than the one
 * cached here. Leaving any of it is how one person's browser shows another
 * person's name, saved posts or follow list for the first second after they
 * sign in.
 */
const SESSION_SCOPED_KEYS = [
  'currentUser',
  'loggedIn',
  'meetifyy_recent_searches',
  'meetify_muted_communities',
  'read_invitations',
  'meetify_following_list',
  'meetify_followers_list',
  'meetify_show_community_details',
];

/**
 * Drops every client-side store that holds one user's data.
 *
 * Separate from storage because these live in memory and in IndexedDB: the
 * saved-posts and saved-activities stores, the post cache, and the service
 * worker's API cache — which is keyed by URL alone and has no idea who was
 * signed in when it recorded a response. On a shared machine that cache is how
 * the next person is served the previous person's feed.
 */
function resetClientStateForNewUser() {
  useSavedPostsStore.getState().clearAll?.();
  useSavedActivitiesStore.getState().clearAll?.();
  usePostStore.getState().clearAll?.();
  idbClearAll().catch((e) => console.error('Failed to clear local cache', e));
  if (typeof caches !== 'undefined') {
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names.filter((n) => n.startsWith('meetifyy-api')).map((n) => caches.delete(n)),
        ),
      )
      .catch(() => {});
  }
}

function clearSessionScopedStorage() {
  try {
    SESSION_SCOPED_KEYS.forEach((key) => localStorage.removeItem(key));
  } catch (_) {
    // Storage disabled: nothing was written, so nothing needs removing.
  }
  try {
    sessionStorage.removeItem('meetifyy_signup_data');
    sessionStorage.removeItem('meetifyy_api_failover');
  } catch (_) {}
}

function isValidUser(u) {
  return (
    u !== null &&
    typeof u === 'object' &&
    typeof u.id === 'string'
  );
}

export function AuthProvider({ children }) {
  // AuthProvider is mounted inside QueryClientProvider (see main.jsx), so the
  // query cache is available here. This is what lets a profile-image change
  // propagate from one place instead of every call site remembering to do it.
  const queryClient = useQueryClient();

  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const savedUser = localStorage.getItem('currentUser');
      if (savedUser) {
        const parsed = JSON.parse(savedUser);
        if (isValidUser(parsed)) {
          return parsed;
        }
      }
    } catch (e) {}
    return null;
  });
  
  /**
   * A thin view of the identity behind the session, for the few call sites that
   * want it (the realtime socket, the settings screen's fallback address).
   *
   * It is NOT what "signed in" is decided from any more. It used to be — the
   * provider's session object was the source of truth — and since that object
   * lives in memory it was empty after every reload, which made a refresh
   * indistinguishable from a sign-out.
   */
  const [session, setSession] = useState(null);

  /**
   * The one place the app's answer to "is anybody signed in?" comes from.
   *
   * Written exactly once per boot, by `initialize` below, and after that only
   * by an explicit sign-in or sign-out. No provider event moves it, which is
   * what stops two listeners racing to overwrite a valid session with a stale
   * one.
   */
  const [authStatus, setAuthStatus] = useState(AUTH_STATUS.INITIALIZING);

  const loading = authStatus === AUTH_STATUS.INITIALIZING;
  const isLoggedIn = authStatus === AUTH_STATUS.AUTHENTICATED;

  const lastSyncAtRef = useRef(0);
  const bookmarksHydratedRef = useRef(false);
  const isLoggingOutRef = useRef(false);
  // Read inside updateProfile without making it a dependency: adding currentUser
  // to that callback's deps would change its identity on every profile change
  // and re-render every consumer of the auth context.
  const currentUserIdRef = useRef(currentUser?.id ?? null);
  const currentUsernameRef = useRef(currentUser?.username ?? null);
  useEffect(() => {
    currentUserIdRef.current = currentUser?.id ?? null;
    currentUsernameRef.current = currentUser?.username ?? null;
  }, [currentUser?.id, currentUser?.username]);

  /**
   * Read by the cross-tab listener, which must not be re-bound every time the
   * status changes — re-binding it mid-sequence is how a tab misses the very
   * event it exists to hear.
   */
  const isLoggedInRef = useRef(false);
  isLoggedInRef.current = isLoggedIn;


  /**
   * Adopts a profile the server has just vouched for.
   *
   * One writer for "this is who is signed in", used by the boot probe, by
   * sign-in and by the end of signup, so the three cannot disagree about what
   * gets written or in what order.
   *
   * `loggedIn` is a local marker, not a credential. It exists so the next boot
   * knows whether it is worth asking the server at all, and so other tabs hear
   * about a sign-in or sign-out through the browser's `storage` event.
   */
  const adoptUser = useCallback((user) => {
    if (!isValidUser(user)) return false;
    setCurrentUser((prev) => {
      // A different account than the one this browser was holding. Nothing
      // belonging to the previous person may survive into this session — not
      // the cached profile, not their saved posts, not their follow lists.
      if (prev && prev.id !== user.id) {
        resetClientStateForNewUser();
      }
      try {
        localStorage.setItem('currentUser', JSON.stringify(user));
        localStorage.setItem('loggedIn', 'true');
      } catch (_) {}
      return user;
    });
    setSession({ user: { id: user.id, email: user.email || '' } });
    setAuthStatus(AUTH_STATUS.AUTHENTICATED);
    return true;
  }, []);

  /**
   * Tears down everything this browser holds for the signed-in user.
   *
   * Local only — it never talks to the server. Callers that mean "end the
   * session" call `logout`, which revokes it server-side first and then calls
   * this.
   */
  const clearLocalSession = useCallback(() => {
    setSession(null);
    setCurrentUser(null);
    setAuthStatus(AUTH_STATUS.UNAUTHENTICATED);
    forgetCsrfToken();
    clearSessionScopedStorage();
    resetClientStateForNewUser();
  }, []);

  /**
   * Asks the server, once, whether this browser is still signed in.
   *
   * The session's durable half is an HttpOnly cookie, so on a fresh load there
   * is nothing in JavaScript to inspect — the question can only be answered by
   * making a request and seeing whether the cookie authenticates it.
   *
   * A GET, and that matters. This used to POST `/api/auth/sync`, which sits
   * behind the double-submit CSRF check — so restoring a session required the
   * page to read the `mf_csrf` cookie, and a page cannot read a cookie scoped
   * to a different hostname. On every deployment where the API is host-only on
   * its own domain, that read came back empty, the probe was skipped entirely,
   * and a signed-in user was shown the landing page on every reload. A safe
   * method carries no CSRF requirement and works in all of them.
   */
  const restoreSession = useCallback(async () => {
    try {
      let res;
      try {
        res = await authApi.currentSession();
      } catch (err) {
        /**
         * The API does not have this route yet.
         *
         * TRANSITIONAL — remove one release after the backend carrying
         * `GET /api/auth/session` is live everywhere.
         *
         * The app and the API deploy independently: Vercel builds the frontend
         * from a Git push while GitHub Actions builds an image, runs migrations
         * and rolls the container. The backend is the slower of the two, so for
         * a few minutes after a merge the new frontend is talking to the old
         * API — and without this, the boot probe 404s, every reload in that
         * window settles signed-out, and signing in fails outright with "this
         * browser did not keep the session".
         *
         * `sync` is the route this replaced and does the same work. It is a
         * POST, so it needs the CSRF header, which is exactly the dependency
         * the GET was introduced to remove — but by this point the token is
         * either in memory from the login response or readable from the cookie,
         * so it is available when this fallback actually runs.
         */
        if (err?.status !== 404) throw err;
        res = await authApi.syncProfile();
      }
      rememberCsrfToken(res?.csrfToken);
      const user = res?.user || null;
      if (!user) return { outcome: 'signed-out' };

      lastSyncAtRef.current = Date.now();

      /**
       * Bookmarks ride along on the same payload, and their own failure is
       * fenced off from this one.
       *
       * Deliberately inside its own try: this function's answer is "is there a
       * session?", and letting a store hydration or a follow-up fetch throw
       * into the outer catch would answer "no" for a session that is perfectly
       * valid. That is a sign-out caused by a saved-posts list.
       */
      try {
        const meta = res?.meta;
        if (meta?.postBookmarkIds) {
          useSavedPostsStore.getState().hydrateFromServer(meta.postBookmarkIds);
        } else if (!bookmarksHydratedRef.current) {
          // Older payloads do not carry the ids. Fetched separately rather than
          // awaited, so the boot is never held on a list nothing on the first
          // screen depends on.
          postsApi
            .getBookmarks(50)
            .then((response) => {
              const ids = (response?.posts || response?.data || []).map((p) => p.id);
              useSavedPostsStore.getState().hydrateFromServer(ids);
            })
            .catch((e) => console.error('Failed to hydrate bookmarks', e));
        }
        if (meta?.activityBookmarkIds) {
          useSavedActivitiesStore.getState().hydrateFromServer(meta.activityBookmarkIds);
        }
        bookmarksHydratedRef.current = true;
      } catch (e) {
        console.error('Failed to hydrate saved items', e);
      }

      return { outcome: 'signed-in', user };
    } catch (err) {
      /**
       * "The server refused me" and "I could not ask the server" are not the
       * same answer, and collapsing them is its own way of signing people out.
       *
       * Only a 401 is authoritative. Everything else — a 429 from a shared
       * campus NAT that has spent its burst budget, a 502 during a deploy, a
       * request that timed out on a train — says nothing about whether the
       * session is valid, and answering "signed out" to any of them logs out a
       * user whose session is perfectly good and whose cookies are still in the
       * browser.
       *
       * This is not ignoring an auth error: a 401 still signs out, immediately
       * and completely. It is refusing to invent one. And it costs nothing in
       * safety, because the cookies are the credential and the server
       * authorizes every request that follows on their own merits — a browser
       * that is wrong about being signed in finds out on its first real call.
       */
      if (err?.status === 401) return { outcome: 'signed-out' };
      console.warn('Could not determine the session; keeping what this browser holds', err);
      return { outcome: 'unknown' };
    }
  }, []);

  /**
   * The boot sequence. Runs once, and is the only thing that may leave
   * `initializing`.
   *
   * It is deliberately linear. The version it replaced ran `getSession()` and
   * an `onAuthStateChange` subscription concurrently, each of which cleared
   * `loading` on its own schedule, plus a three-second timer that cleared it
   * whether or not anything had finished. Three writers, no ordering — so the
   * router routinely made its decision on the answer that happened to land
   * first, which on a reload was always "nobody is signed in".
   */
  useEffect(() => {
    let cancelled = false;

    const signedOut = () => {
      if (cancelled) return;
      setSession(null);
      setCurrentUser(null);
      setAuthStatus(AUTH_STATUS.UNAUTHENTICATED);
      try { localStorage.removeItem('currentUser'); } catch (_) {}
      try { localStorage.removeItem('loggedIn'); } catch (_) {}
    };

    /**
     * We could not reach the server, so we do not know.
     *
     * Falls back to the profile this browser already holds, if it holds one.
     * Every request still has to authenticate, so the worst case is an app that
     * renders a shell and then finds out — which is a far better outcome than
     * showing the landing page to somebody who is signed in because their
     * campus network briefly rate-limited the boot.
     */
    const settleUnknown = () => {
      if (cancelled) return;
      let cached = null;
      try {
        const raw = localStorage.getItem('currentUser');
        cached = raw ? JSON.parse(raw) : null;
      } catch (_) {}
      if (isValidUser(cached) && adoptUser(cached)) return;
      signedOut();
    };

    const settle = (result) => {
      if (cancelled) return;
      if (result?.outcome === 'signed-in' && adoptUser(result.user)) return;
      if (result?.outcome === 'unknown') return settleUnknown();
      signedOut();
    };

    (async () => {
      // A tab opened from a password-recovery link holds a one-time credential
      // that belongs to ResetPasswordPage and to nothing else. The app boots
      // signed out; broadcasting that session here would hand a recovery link
      // the run of every protected route.
      if (isRecoveryPending()) return signedOut();

      if (!isSupabaseConfigured) return signedOut();

      // Nothing suggests a session, so do not spend a request being told so.
      // Every first-time arrival and every shared link lands here.
      if (!mayHaveCookieSession()) return signedOut();

      settle(await restoreSession());
    })();

    return () => { cancelled = true; };
  }, [adoptUser, restoreSession]);

  /**
   * Tell the launch shell it may lift.
   *
   * The shell is the white screen with the logo that the document paints
   * before any JavaScript runs (see index.html). It used to dismiss itself on
   * React's first frame, which is well before this point — so the app rendered
   * its route gates against an undecided session and showed the landing page
   * for a moment on every authenticated reload.
   *
   * Signalling from here is what makes the sequence honest: the shell covers
   * the whole of `initializing`, and lifts onto whichever app the answer calls
   * for. It is called for BOTH outcomes — an unauthenticated boot has finished
   * initializing just as much as an authenticated one has.
   */
  useEffect(() => {
    if (authStatus === AUTH_STATUS.INITIALIZING) return;
    try {
      window.__meetifyyBoot?.ready?.();
    } catch (_) {
      // The shell is a progressive enhancement; the app renders without it.
    }
  }, [authStatus]);

  /**
   * Another tab signed in, signed out, or switched accounts.
   *
   * `storage` fires only in the tabs that did NOT make the change, which is
   * exactly the set that needs telling. Without it, signing out in one tab left
   * every other tab authenticated against cookies the server had already
   * revoked — and signing in as somebody else left them rendering the previous
   * account's name and data until they happened to be reloaded.
   */
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== 'loggedIn' && e.key !== 'currentUser') return;

      let stored = null;
      try {
        const raw = localStorage.getItem('currentUser');
        stored = raw ? JSON.parse(raw) : null;
      } catch (_) {}

      const signedOutElsewhere = !stored || localStorage.getItem('loggedIn') !== 'true';
      if (signedOutElsewhere) {
        if (isLoggedInRef.current) clearLocalSession();
        return;
      }
      if (!isValidUser(stored)) return;
      // A different account now owns this browser, or this tab had none.
      if (stored.id !== currentUserIdRef.current || !isLoggedInRef.current) {
        adoptUser(stored);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [adoptUser, clearLocalSession]);


  const login = useCallback(async (usernameOrEmail, password) => {
    isLoggingOutRef.current = false;
    if (!isSupabaseConfigured) throw new Error('Supabase is not configured.');

    // Single server-side login call. The backend resolves username→email
    // internally (the email is never exposed to the client), authenticates via
    // Supabase, rate-limits brute force, records the device, and fires the
    // login-notification email asynchronously.
    const BASE_URL = getBackendUrl();
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      // Without this the browser discards the Set-Cookie on the response,
      // because the API is a different origin from the app. Login would appear
      // to succeed and leave no session cookie behind, so the next reload would
      // find nothing to recover and drop the user back at the login screen.
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: usernameOrEmail.trim(), password }),
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody?.message || 'Invalid username/email or password.');
    }

    const body = await res.json().catch(() => null);
    rememberCsrfToken(body?.csrfToken);

    /**
     * No token is installed into the provider client, and that is the fix.
     *
     * This used to take `access_token` and `refresh_token` out of the response
     * and call `supabase.auth.setSession(...)`, which made the provider client
     * the owner of the session: it persisted the pair, started its own refresh
     * ticker, and announced SIGNED_IN, which a second listener elsewhere turned
     * into a profile sync. Three problems came out of that, and all three are
     * gone now that the response carries no tokens at all.
     *
     * The refresh token was in JavaScript, which is the exposure HttpOnly
     * cookies exist to close. The same rotating token was held by this tab AND
     * by the server, so whichever refreshed first retired the other's copy and
     * a later use of the retired one trips Supabase's reuse detection, which
     * revokes every session the account has. And "signed in" was derived from
     * an object that lives in memory, so it was gone on the next reload.
     *
     * The credential is the cookie set on this response. Confirming it is one
     * GET, which also returns the full profile — so the app reaches its first
     * authenticated render already knowing who it is showing.
     */
    const restored = await restoreSession();
    const user = restored?.outcome === 'signed-in' ? restored.user : null;
    if (!user) {
      // The cookies did not come back, or did not authenticate. Almost always a
      // cookie-attribute mismatch between the API's host and the app's, which
      // is silent in the network tab and used to present as "logged in, then
      // immediately logged out".
      throw new Error("Signed in, but this browser did not keep the session. Please try again.");
    }
    adoptUser(user);
    return true;
  }, [adoptUser, restoreSession]);

  const initiateSignup = useCallback(async (userData) => {
    // Checked here even though this step no longer talks to Supabase itself.
    // The very next step does — `verifySignupOtp` is what mints the browser's
    // session — so creating an account that can never be verified in this
    // build would be worse than refusing at the start.
    if (!isSupabaseConfigured) throw new Error('Supabase is not configured.');

    if (!userData.email || !userData.email.trim()) {
      throw new Error('College email is required to sign up. Please check your details.');
    }
    if (!userData.birthday) {
      throw new Error('Date of birth is required.');
    }
    if (!userData.password) {
      throw new Error('Password is required.');
    }

    const computedDisplayName = userData.displayName || userData.name || (
      userData.firstName
        ? `${userData.firstName} ${userData.lastName || ''}`.trim()
        : userData.username
    );

    /*
     * This one call is the whole of the "Next" button on the password step.
     *
     * It goes to OUR API, not straight to Supabase Auth. It used to go direct,
     * which meant the request passed through nothing of ours and could not be
     * metered: signup sends mail, and every message it sends draws on the same
     * shared per-project Supabase budget as every OTP in the app, so an
     * unmetered signup endpoint is a way to stop every other student receiving
     * their confirmation code. The backend enforces a per-IP and a per-address
     * budget before it forwards anything.
     *
     * The project has `mailer_autoconfirm: false`, which means the confirmation
     * email is sent as part of THIS request rather than after it. The call
     * therefore waits on the mail provider, and a provider that is slow or
     * failing shows up here as a slow or failed signup, not as a mail problem.
     * That is why it is given a deadline below instead of waiting on the
     * browser's own, which is minutes long.
     *
     * No session comes back and none should: the account is created
     * unconfirmed, and the browser gets its session from `verifyOtp` once the
     * emailed code is entered.
     */
    try {
      await withTimeout(
        apiClient.post('/api/auth/signup', {
          email: userData.email.trim().toLowerCase(),
          password: userData.password,
          displayName: computedDisplayName,
          username: userData.username,
          birthday: userData.birthday,
          firstName: userData.firstName,
          lastName: userData.lastName,
          // Academic info is NOT sent to Supabase user_metadata: Prisma is the
          // source of truth for it, and metadata is writable by the user it
          // belongs to, so a copy there could disagree with the validated
          // record. The backend drops anything else this object carries.
        }),
        SIGNUP_TIMEOUT_MS,
      );
    } catch (err) {
      /*
       * An error carrying a status reached the server and came back — a weak
       * password, an address already part-way through signup (409), a spent
       * rate-limit budget (429). Its message is the useful one and is passed
       * through untouched.
       *
       * An error without one never produced a response at all: blocked,
       * offline, or timed out. The browser reports those as a bare "Failed to
       * fetch", which tells the user nothing and sends whoever reads the bug
       * report looking at the wrong system.
       */
      if (err?.status) {
        throw new Error(err.message || 'Signup failed. Please try again.');
      }

      const host = signupHost();
      logNetworkFailure('signup', err, { host, step: 'POST /api/auth/signup' });
      const explained = describeNetworkError(err, {
        host,
        action: 'create your account',
      });
      throw new Error(explained || err?.message || 'Signup failed. Please try again.');
    }

    // We don't log them in yet — they must verify OTP first.
    return true;
  }, []);

  /**
   * Re-send the signup confirmation code.
   *
   * Proxied for the same reason signup itself is, and metered by the same two
   * budgets: this is the other button on the code screen that sends mail, and
   * leaving it direct would have left the cheaper of the two paths open.
   */
  const resendSignupOtp = useCallback(async (email) => {
    try {
      await apiClient.post('/api/auth/signup/resend', { email });
    } catch (err) {
      if (err?.status) {
        throw new Error(err.message || 'Failed to resend code. Please try again.');
      }
      const host = signupHost();
      logNetworkFailure('signup-resend', err, {
        host,
        step: 'POST /api/auth/signup/resend',
      });
      const explained = describeNetworkError(err, {
        host,
        action: 'send your code',
      });
      throw new Error(explained || err?.message || 'Failed to resend code. Please try again.');
    }
    return true;
  }, []);

  const verifySignupOtp = useCallback(async (email, token, signupData = {}) => {
    if (!isSupabaseConfigured) throw new Error('Supabase is not configured.');

    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: 'signup'
    });

    if (error) {
      const msg = typeof error.message === 'string' && error.message.trim() !== '' && error.message !== '{}'
        ? error.message
        : (error.error_description || error.msg || 'Invalid verification code.');
      throw new Error(msg);
    }

    if (data.session) {
      const user = data.user;
      const username = typeof signupData === 'string' ? signupData : (signupData.username || user.user_metadata?.username);
      const payloadObj = typeof signupData === 'object' && signupData !== null ? signupData : { username };
      const displayName = payloadObj.displayName || (payloadObj.firstName
        ? `${payloadObj.firstName} ${payloadObj.lastName || ''}`.trim()
        : (user.user_metadata?.displayName || username));

      let profile = {
        id: user.id,
        email: user.email,
        username: username,
        displayName: displayName,
        role: 'Student',
      };

      // Clear stale signup session data — the OTP is now used and should not be replayable
      sessionStorage.removeItem('meetifyy_signup_data');

      // Immediately persist gathered profile details to backend database.
      // The backend syncProfile gate will allow this because email_confirmed_at
      // is now set (Supabase marks it on successful OTP verification).
      //
      // This still travels on the bearer token: the cookies do not exist yet,
      // and creating them is the next step.
      try {
        const { password, ...safeData } = payloadObj;
        const response = await usersApi.updateProfile({
          ...safeData,
          displayName,
          username,
        });
        const syncedUser = response?.user || response;
        if (syncedUser) profile = { ...profile, ...syncedUser };
      } catch (err) {
        console.error('Failed to sync profile immediately on OTP verification', err);
      }

      /**
       * Hand the provider session to the server, and stop holding it here.
       *
       * Signup is the only flow left that mints a session in the browser —
       * `verifyOtp` is what confirms the emailed code, and it answers with one.
       * Before this call existed, that session simply stayed in the tab: a new
       * account had no cookies, no row in its own device list, nothing that
       * "sign out this device" could act on, and was signed out by its first
       * reload. Its refresh token also stayed in JavaScript for as long as the
       * tab was open.
       *
       * Adopting it converts it into the same cookie session every other signed
       * -in browser has. The local sign-out immediately afterwards is scoped to
       * this device only — the account's provider session must survive, because
       * the server is now the one using it.
       */
      try {
        const adopted = await authApi.adoptSession(data.session.refresh_token);
        rememberCsrfToken(adopted?.csrfToken);
        if (adopted?.user) profile = { ...profile, ...adopted.user };
      } catch (err) {
        // The account exists and is verified, so this is not a signup failure.
        // The session is simply not durable yet; the next sign-in creates one.
        console.error('Failed to establish a session after verification', err);
      } finally {
        try { await supabase.auth.signOut({ scope: 'local' }); } catch (_) {}
      }

      adoptUser(profile);
    }

    return true;
  }, [adoptUser]);

  /**
   * Finishes account setup: marks the profile complete and sends the welcome
   * email.
   *
   * Called from the last signup step. It used to be called from the onboarding
   * screen, which was the only thing that ever set `profileCompleted` or
   * triggered the welcome email — so with that screen gone this moved to the
   * end of signup rather than being deleted with it, or new accounts would stay
   * flagged incomplete forever and nobody would be welcomed.
   */
  const completeSignup = useCallback(async (updatedData = {}) => {
    try {
      const { password, ...safeData } = updatedData;
      const response = await usersApi.updateProfile({ ...safeData, profileCompleted: true });
      const syncedUser = response?.user || response;

      // Mirror the flag into Supabase user_metadata, but don't block navigation
      // on it — Prisma's profileCompleted (set above) is the source of truth.
      if (isSupabaseConfigured) {
        supabase.auth.updateUser({
          data: { profileCompleted: true }
        }).catch(err => console.error('Failed to update Supabase profileCompleted metadata', err));
      }

      if (syncedUser) {
        setCurrentUser(prev => {
          const updated = { ...prev, ...syncedUser, profileCompleted: true };
          delete updated.password;
          localStorage.setItem('currentUser', JSON.stringify(updated));
          
          // Trigger welcome email
          apiClient.post('/api/auth/events/welcome', { email: updated.email, name: updated.displayName })
            .catch(console.error);
          
          return updated;
        });
      }
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  }, []);

  const updateProfile = useCallback(async (updatedData) => {
    const userId = currentUserIdRef.current;
    const username = currentUsernameRef.current;

    /**
     * What the optimistic write below is about to overwrite.
     *
     * The write reaches `localStorage` and dozens of cached payloads, so a save
     * that then fails used to leave the browser showing a change the server
     * never received — and showing it across reloads, because it had been
     * persisted locally. An avatar picked while the network was down looked
     * applied to its owner and to nobody else, including on their own posts,
     * which read the server's copy.
     */
    /**
     * A synchronous snapshot of what the optimistic write is about to replace.
     *
     * Read from storage rather than captured from `currentUser` or from inside
     * the state updater: the closure can hold an older render, and React does
     * not run a functional update synchronously — the updater had not fired yet
     * by the time a failed request reached the catch, so there was nothing to
     * restore. This is the same string the optimistic write overwrites, read
     * before it happens.
     */
    let rollbackRaw = null;
    try {
      rollbackRaw = localStorage.getItem('currentUser');
    } catch (_) {
      // Storage unavailable; the optimistic write below will not have persisted
      // anything either, so there is nothing to put back.
    }
    const rollbackUser = (() => {
      try {
        return rollbackRaw ? JSON.parse(rollbackRaw) : null;
      } catch (_) {
        return null;
      }
    })();
    const rollbackMedia = {
      avatar: rollbackUser?.avatar,
      cover: rollbackUser?.cover,
      displayName: rollbackUser?.displayName,
    };

    // Avatar/cover live denormalised inside dozens of cached payloads (post
    // authors, comment authors, chat participants, search hits, directory
    // cards). Patch them all up front so the new image is on screen at the next
    // paint rather than whenever each query happens to refetch.
    if (userId && (updatedData?.avatar !== undefined || updatedData?.cover !== undefined || updatedData?.displayName !== undefined)) {
      propagateUserMedia(queryClient, {
        userId,
        username,
        ...(updatedData.avatar !== undefined ? { avatar: updatedData.avatar } : {}),
        ...(updatedData.cover !== undefined ? { cover: updatedData.cover } : {}),
        ...(updatedData.displayName !== undefined ? { displayName: updatedData.displayName } : {}),
      });
    }

    setCurrentUser(prev => {
      if (!prev) return prev;
      const newAvatar = updatedData.avatar !== undefined ? updatedData.avatar : (updatedData.avatarUrl !== undefined ? updatedData.avatarUrl : prev.avatar);
      const updated = {
        ...prev,
        ...updatedData,
        avatar: newAvatar,
        avatarUrl: newAvatar,
      };
      delete updated.password;
      localStorage.setItem('currentUser', JSON.stringify(updated));
      return updated;
    });

    try {
      const response = await usersApi.updateProfile(updatedData);
      const syncedUser = response?.user || response;
      if (syncedUser) {
        // Reconcile against what the server actually stored, in case it
        // normalised or rejected the key we optimistically applied.
        if (userId && (syncedUser.avatar !== undefined || syncedUser.cover !== undefined || syncedUser.displayName !== undefined)) {
          propagateUserMedia(queryClient, {
            userId,
            username: syncedUser.username || username,
            ...(syncedUser.avatar !== undefined ? { avatar: syncedUser.avatar } : {}),
            ...(syncedUser.cover !== undefined ? { cover: syncedUser.cover } : {}),
            ...(syncedUser.displayName !== undefined ? { displayName: syncedUser.displayName } : {}),
          });
        }
        setCurrentUser(prev => {
          const newAvatar = syncedUser.avatar !== undefined ? syncedUser.avatar : prev.avatar;
          const updated = {
            ...prev,
            ...syncedUser,
            avatar: newAvatar,
            avatarUrl: newAvatar,
          };
          delete updated.password;
          localStorage.setItem('currentUser', JSON.stringify(updated));
          return updated;
        });
      }
      return true;
    } catch (e) {
      // Put back what was on screen before, so local state matches what the
      // server actually holds rather than a change it refused.
      if (rollbackUser) {
        // Restored through the updater queue, not before it. The optimistic
        // write persists to storage from inside its own updater, which React
        // runs whenever it next renders — writing the old value here directly
        // put it back before that updater had run, and the optimistic one then
        // overwrote it again.
        setCurrentUser(() => {
          try {
            localStorage.setItem('currentUser', rollbackRaw);
          } catch (_) {
            // Storage failure is not worth masking the save error below.
          }
          return rollbackUser;
        });
      }
      if (userId) {
        propagateUserMedia(queryClient, {
          userId,
          username,
          ...(rollbackMedia.avatar !== undefined ? { avatar: rollbackMedia.avatar } : {}),
          ...(rollbackMedia.cover !== undefined ? { cover: rollbackMedia.cover } : {}),
          ...(rollbackMedia.displayName !== undefined
            ? { displayName: rollbackMedia.displayName }
            : {}),
        });
      }
      // Rethrown rather than returned as `false`: every caller already wraps
      // this in a `.catch()` or a try/catch that shows the user the save
      // failed, and none of them could ever fire while this resolved. The
      // avatar picker in particular reported "Avatar updated" on a save that
      // had not happened.
      console.error(e);
      throw e;
    }
  }, [queryClient]);

  const updateSettings = useCallback(async (settingsData) => {
    setCurrentUser(prev => {
      if (!prev) return prev;
      const mergedSettings = {
        ...(prev?.settings || {}),
        ...(prev?.preferences || {}),
        ...settingsData
      };
      const updated = {
        ...prev,
        settings: mergedSettings,
        preferences: mergedSettings
      };
      localStorage.setItem('currentUser', JSON.stringify(updated));
      return updated;
    });

    try {
      const res = await usersApi.updateSettings(settingsData);
      const { id, userId, createdAt, updatedAt, ...cleanRes } = (res && typeof res === 'object') ? res : {};
      setCurrentUser(prev => {
        const mergedSettings = {
          ...(prev?.settings || {}),
          ...(prev?.preferences || {}),
          ...cleanRes,
          ...settingsData
        };
        const updated = {
          ...prev,
          settings: mergedSettings,
          preferences: mergedSettings
        };
        localStorage.setItem('currentUser', JSON.stringify(updated));
        return updated;
      });
      return true;
    } catch (e) {
      console.error('Failed to update settings in AuthContext:', e);
      return false;
    }
  }, []);

  const updateCurrentUser = useCallback((user) => {
    if (user === null) {
      setCurrentUser(null);
      localStorage.removeItem('currentUser');
      return;
    }
    if (isValidUser(user)) {
      const safeAvatar = user.avatar || user.avatarUrl;
      const safeUser = {
        ...user,
        avatar: safeAvatar,
        avatarUrl: safeAvatar,
      };
      delete safeUser.password;
      setCurrentUser(safeUser);
      localStorage.setItem('currentUser', JSON.stringify(safeUser));
    } else {
      console.warn('updateCurrentUser received invalid user object, ignoring update:', user);
    }
  }, []);

  const changePassword = useCallback(async (currentPassword, newPassword) => {
    if (!isSupabaseConfigured) throw new Error('Supabase is not configured.');

    // No email precondition here any more. It was required back when this
    // verified the current password with `signInWithPassword`, which needed an
    // address to sign in with. Verification is now a server call that reads the
    // caller's identity from their token, so demanding a client-side copy only
    // refused the password change outright — with "User email not found" — for
    // an account whose cached profile happened not to carry one.
    if (currentPassword === newPassword) {
      const err = new Error('New password must be different from current password.');
      err.code = 'PASSWORD_REUSE';
      throw err;
    }

    /**
     * One server call: verify, change, and sign every other device out.
     *
     * This used to be three client-side steps — verify, `supabase.auth
     * .updateUser`, then `signOut({ scope: 'others' })`. The middle one broke
     * when the session moved out of localStorage: the provider's client keeps
     * its session in memory, so after any reload there was nothing for it to
     * update with, and the change failed on a form that had already reported
     * success.
     *
     * Server-side it also gets what the client version never had — the current
     * password checked against a per-user budget rather than trusted, and the
     * revocation performed as part of the change rather than as a follow-up
     * call that could be skipped or fail on its own.
     */
    try {
      await apiClient.post('/api/auth/change-password', {
        currentPassword,
        newPassword,
      });
    } catch (err) {
      // A spent budget carries its own wait and is the one failure the user can
      // act on, so it passes through unflattened.
      if (err?.status === 429) throw err;
      if (err?.status === 401) {
        const wrong = new Error('Incorrect current password.');
        wrong.code = 'WRONG_CURRENT_PASSWORD';
        throw wrong;
      }
      throw new Error(err?.message || "Couldn't update your password.");
    }

    // Nothing to adopt afterwards.
    //
    // The old flow had to re-read the session because `updateUser` rotated it
    // and announced a USER_UPDATED that onAuthStateChange deliberately drops,
    // leaving `session` on the pre-change token — which the realtime socket
    // keys on, so it held a superseded token until the next refresh. The change
    // no longer happens in the browser, so no rotation happens here and the
    // session this device holds is the one it keeps.

    // 5. Send "Password Changed" security notification email.
    //    Fire-and-forget — the password is already changed, so don't make the
    //    user wait on an email round-trip before the success UI shows.
    apiClient.post('/api/auth/events/password-changed', {
      // Omitted rather than sent empty when we do not have one: the server then
      // resolves the recipient from the verified token, which is the address
      // that actually owns the account.
      ...(currentUser?.email ? { email: currentUser.email } : {}),
      name: currentUser?.displayName || 'User',
      time: new Date().toLocaleString('en-US', {
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      }),
      device: navigator.userAgent,
    }).catch(() => {
      // Non-fatal — password was still changed. Email failure must not surface
      // as a password-change error to the user.
    });

    return true;
  }, [currentUser]);

  /**
   * Ends the session — on the server first, then here.
   *
   * The server call is the part that was missing, and its absence was not a
   * cosmetic gap. Signing out cleared React state and some `localStorage` keys
   * and stopped there: the session row stayed live, and the HttpOnly cookies
   * stayed in the browser, because only the server can clear a cookie it set
   * with those attributes. The next reload found those cookies, asked the
   * server who they belonged to, and was told — correctly — that they belonged
   * to the person who had just signed out. On a shared machine that is the next
   * person inheriting an account, and no amount of clearing on this side could
   * have prevented it.
   *
   * Local teardown happens whether or not the call succeeds. A user who has
   * asked to be signed out is signed out of this browser regardless; if the
   * request failed, the cookies that remain are the ones the next boot will
   * discover are revoked.
   *
   * `signOut({ scope: 'local' })`, never the default global scope. The provider
   * session belongs to the server now, and other devices have their own rows in
   * the session table — ending one device's session here must not end theirs.
   */
  const logout = useCallback(async () => {
    isLoggingOutRef.current = true;
    try {
      await authApi.logoutSession();
    } catch (e) {
      console.error('Server sign-out failed; clearing this browser anyway', e);
    }

    clearLocalSession();

    if (isSupabaseConfigured) {
      try {
        await supabase.auth.signOut({ scope: 'local' });
      } catch (e) {
        console.error('Supabase signOut error', e);
      }
    }
    isLoggingOutRef.current = false;
  }, [clearLocalSession]);

  /**
   * The API client has established that the session is over.
   *
   * Local teardown only. It used to call `logout()`, which now posts to the
   * server — and posting a sign-out with credentials the server has already
   * refused is a guaranteed second failure, on the way to doing exactly what
   * this does. The server has already cleared what it could on the response
   * that produced the 401.
   */
  useEffect(() => {
    const handleUnauthorized = () => {
      if (isLoggedInRef.current) clearLocalSession();
    };
    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => {
      window.removeEventListener('auth:unauthorized', handleUnauthorized);
    };
  }, [clearLocalSession]);

  const username = currentUser?.username || '';
  const initial = username ? username.charAt(0).toUpperCase() : '?';
  const displayName = currentUser?.displayName || '';
  const collegeName = getCollegeName(currentUser);

  /**
   * Memoised because `useAuth()` is read almost everywhere — every post card,
   * every comment node, the header, the sidebar.
   *
   * This used to be an object literal, so it was a new value on every render of
   * this provider, and a context value changing re-renders every consumer
   * whether or not the part it reads has moved. React.memo cannot stop that: a
   * context read is not a prop. The provider sits above the whole app, so any
   * state it holds — a session refresh, a settings save — cascaded into the
   * entire tree.
   *
   * Every callback below is already `useCallback`-stable, so in practice this
   * value now changes only when the session or the user actually changes.
   */
  const value = useMemo(() => ({
    isLoggedIn,
    session,
    /**
     * `initializing` | `authenticated` | `unauthenticated`.
     *
     * Read this, not `loading`, when the question is "may I route yet?".
     * `loading` is kept as the derived boolean it always was so existing
     * consumers keep working, but it cannot express the difference between
     * "still deciding" and "decided: nobody", and that difference is the whole
     * bug it was part of.
     */
    authStatus,
    loading,
    currentUser,
    username,
    displayName,
    initial,
    collegeName,
    login,
    initiateSignup,
    resendSignupOtp,
    verifySignupOtp,
    completeSignup,
    updateProfile,
    updateSettings,
    updateCurrentUser,
    changePassword,
    logout,
    isSupabaseConfigured,
  }), [
    isLoggedIn, session, authStatus, loading, currentUser, username, displayName, initial,
    collegeName, login, initiateSignup, resendSignupOtp, verifySignupOtp,
    completeSignup, updateProfile, updateSettings, updateCurrentUser,
    changePassword, logout,
  ]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

/**
 * The answer when there is no provider above — a frozen module constant, not a
 * fresh literal per call. Returning a new object each time made every consumer
 * outside a provider (tests, isolated previews, the public shell) see a
 * "changed" value on every render.
 */
const NO_AUTH = Object.freeze({
  isLoggedIn: false,
  session: null,
  authStatus: AUTH_STATUS.UNAUTHENTICATED,
  loading: false,
  currentUser: null,
  username: '',
  displayName: '',
  initial: '?',
  collegeName: '',
  login: async () => {},
  initiateSignup: async () => {},
  resendSignupOtp: async () => {},
  verifySignupOtp: async () => {},
  completeSignup: async () => {},
  updateProfile: async () => {},
  updateSettings: async () => {},
  updateCurrentUser: () => {},
  changePassword: async () => {},
  logout: async () => {},
  isSupabaseConfigured: true,
});

export function useAuth() {
  return useContext(AuthContext) ?? NO_AUTH;
}
