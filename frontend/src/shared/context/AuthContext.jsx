import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { usersApi, apiClient, postsApi, getBackendUrl, readCsrfCookie } from '@shared/api/apiClient';
import { followGraphChangedSince } from '../utils/followState';
import { useSavedPostsStore } from '../stores/savedPostsStore';
import { useSavedActivitiesStore } from '../stores/savedActivitiesStore';
import usePostStore from '../stores/postStore';
import { showToast } from '@shared/utils/toast';
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
  
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  /**
   * True when the server has confirmed this browser's cookie session.
   *
   * Needed because `session` holds the Supabase session, which now lives in
   * memory and is therefore empty after every reload — the durable half is an
   * HttpOnly cookie this code cannot read. Deriving "signed in" from `session`
   * alone meant a refresh looked exactly like a sign-out: the cookie was
   * valid, the server said so, and the app still showed the landing page.
   */
  const [hasCookieSession, setHasCookieSession] = useState(false);

  const isLoggedIn = !!session || hasCookieSession;

  const lastSyncAtRef = useRef(0);
  const syncPromiseRef = useRef(null);
  const bookmarksHydratedRef = useRef(false);
  const syncDebounceRef = useRef(null);
  const isLoggingOutRef = useRef(false);
  // Counts back-to-back 401s from /api/auth/sync so a token the backend will
  // never accept can't spin forever (see performSync's catch block).
  const consecutiveSyncAuthFailuresRef = useRef(0);
  // Read inside updateProfile without making it a dependency: adding currentUser
  // to that callback's deps would change its identity on every profile change
  // and re-render every consumer of the auth context.
  const currentUserIdRef = useRef(currentUser?.id ?? null);
  const currentUsernameRef = useRef(currentUser?.username ?? null);
  useEffect(() => {
    currentUserIdRef.current = currentUser?.id ?? null;
    currentUsernameRef.current = currentUser?.username ?? null;
  }, [currentUser?.id, currentUser?.username]);

  const performSync = useCallback(async (supabaseSession, event) => {
    if (syncPromiseRef.current) {
      return syncPromiseRef.current;
    }

    // Stamped BEFORE the request goes out, so the merge below can tell whether
    // the answer predates a follow the viewer performed while it was in
    // flight. See the followingList branch there.
    const syncStartedAt = Date.now();

    syncPromiseRef.current = (async () => {
      try {
        const syncRes = await apiClient.post('/api/auth/sync');
        const syncedUser = syncRes?.user || syncRes;
        lastSyncAtRef.current = Date.now();
        consecutiveSyncAuthFailuresRef.current = 0;
        if (isValidUser(syncedUser)) {
          setCurrentUser(prev => {
            const sbEmail = supabaseSession?.user?.email;
            const cleanEmail = (syncedUser.email && !syncedUser.email.endsWith('@meetifyy.user'))
              ? syncedUser.email
              : (sbEmail || prev?.email || '');
            const newAvatar = syncedUser.avatar || syncedUser.avatarUrl || prev?.avatar || prev?.avatarUrl;
            // A sync response carries a snapshot of the follow graph. If the
            // viewer followed or unfollowed someone after this request was
            // issued, the snapshot is older than what the client already
            // knows, and taking it would revert the change — the "it says
            // Follow again a moment later" report. Keep the local list in that
            // case; the next sync (or the follow response itself, which is
            // authoritative) reconciles it.
            const followListIsStale =
              followGraphChangedSince(syncStartedAt) && Array.isArray(prev?.followingList);
            const mergedUser = {
              ...syncedUser,
              ...(followListIsStale ? { followingList: prev.followingList } : {}),
              email: cleanEmail,
              avatar: newAvatar,
              avatarUrl: newAvatar,
              settings: syncedUser.settings || prev?.settings || prev?.preferences,
              preferences: syncedUser.settings || prev?.preferences || prev?.settings,
            };
            try { localStorage.setItem('currentUser', JSON.stringify(mergedUser)); } catch (_) {}
            return mergedUser;
          });

          // Hydrate bookmarks only ONCE per session — not on token refresh events.
          if (!bookmarksHydratedRef.current && event !== 'TOKEN_REFRESHED') {
            bookmarksHydratedRef.current = true;

            const meta = syncRes?.meta;
            if (meta?.postBookmarkIds) {
              useSavedPostsStore.getState().hydrateFromServer(meta.postBookmarkIds);
            }
            if (meta?.activityBookmarkIds) {
              useSavedActivitiesStore.getState().hydrateFromServer(meta.activityBookmarkIds);
            }

            if (!meta?.postBookmarkIds) {
              setTimeout(async () => {
                try {
                  const response = await postsApi.getBookmarks(50);
                  const bookmarkedPostIds = (response?.posts || response?.data || []).map(p => p.id);
                  useSavedPostsStore.getState().hydrateFromServer(bookmarkedPostIds);
                } catch (bookmarkErr) {
                  console.error('Failed to hydrate bookmarks', bookmarkErr);
                }
              }, 2000);
            }
          }
        }
        return syncRes;
      } catch (err) {
        if (err?.status === 401) {
          // The backend rejected this token outright. Supabase-js will keep
          // retrying a refresh it cannot complete, and every retry fires another
          // auth event that lands back here — so swallowing the 401 span an
          // endless sync loop (observed at ~2 req/s indefinitely) that never
          // recovered and never let the user reach the login screen.
          //
          // Two consecutive failures, rather than one, so a transient blip
          // while the backend is warming its token verification doesn't sign
          // anyone out. Past that the credential is genuinely not accepted, and
          // the only correct move is to drop it locally so the app falls back
          // to the login screen.
          consecutiveSyncAuthFailuresRef.current += 1;
          if (consecutiveSyncAuthFailuresRef.current >= 2) {
            consecutiveSyncAuthFailuresRef.current = 0;
            try { await supabase.auth.signOut({ scope: 'local' }); } catch (_) {}
          }
        } else {
          console.error('Failed to sync profile on auth change', err);
        }
      } finally {
        syncPromiseRef.current = null;
      }
    })();

    return syncPromiseRef.current;
  }, []);

  /**
   * Asks the server whether this browser is still signed in.
   *
   * The session's durable half is an HttpOnly cookie, so on a fresh load there
   * is nothing in JavaScript to inspect — the question can only be answered by
   * making a request and seeing whether the cookie authenticates it. `sync`
   * returns the caller's own profile and is reachable in the restricted account
   * states too, which is exactly what a boot needs.
   *
   * Returns the user, or null when the cookie is missing, expired or revoked.
   * A revoked session lands here as a 401 and signs the app out, which is the
   * whole point of the session table behind it.
   */
  const hydrateFromCookie = useCallback(async () => {
    // The CSRF cookie is set beside the session cookies and, unlike them, is
    // readable. Its absence means there is no cookie session to recover, so a
    // signed-out visitor — every first-time arrival, every logged-out share
    // link — skips this entirely instead of spending a request to be told 401.
    // This is a hint, not a decision: the server still authorizes, and a forged
    // CSRF cookie buys nothing but a wasted round trip.
    if (!readCsrfCookie()) return null;

    try {
      const res = await apiClient.post('/api/auth/sync');
      const user = res?.user || null;
      if (user) {
        setHasCookieSession(true);
        setCurrentUser(user);
        try {
          localStorage.setItem('currentUser', JSON.stringify(user));
          localStorage.setItem('loggedIn', 'true');
        } catch (_) {}
      }
      return user;
    } catch (_) {
      // 401, offline, anything: treat as not signed in. The caller clears state.
      setHasCookieSession(false);
      return null;
    }
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) {
       setLoading(false);
       return;
     }

    // Safety timeout: Ensure loading is never permanently true on slow/offline mobile devices
    const authTimeout = setTimeout(() => {
      setLoading(false);
    }, 3000);

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      clearTimeout(authTimeout);
      // ─── Recovery session guard ────────────────────────────────────────
      // If this tab was opened from a password recovery link, supabase.js
      // wrote 'sb-pwreset-pending' to sessionStorage BEFORE createClient()
      // processed the hash. When that flag is present, the current session
      // is a temporary recovery credential — do NOT set it into global auth
      // state. Doing so would make isLoggedIn = true for the whole app and
      // give the recovery session access to all protected routes.
      // ResetPasswordPage consumes and clears this flag after validation.
      // ──────────────────────────────────────────────────────────────────
      let pendingRecovery = false;
      try { pendingRecovery = sessionStorage.getItem('sb-pwreset-pending') === '1'; } catch {}

      if (pendingRecovery) {
        // The onAuthStateChange PASSWORD_RECOVERY handler (or INITIAL_SESSION
        // with recovery flag) will resolve the session on the reset page.
        setLoading(false);
        return;
      }

      if (!session) {
        /**
         * No session in memory does not mean signed out any more.
         *
         * Tokens are no longer written to localStorage, so a reload always
         * starts with an empty client — the durable half of the session is an
         * HttpOnly cookie this code cannot read. The only way to find out
         * whether the browser is still signed in is to ask the server, which
         * `sync` answers using that cookie.
         *
         * Without this, moving the session out of localStorage would log
         * everyone out on every refresh.
         */
        hydrateFromCookie()
          .then((user) => {
            if (!user) {
              setCurrentUser(null);
              try { localStorage.removeItem('currentUser'); } catch (_) {}
            }
          })
          .finally(() => setLoading(false));

        if (!isLoggingOutRef.current) {
          setSession(session);
        }
        return;
      }
      if (!isLoggingOutRef.current) {
        setSession(session);
      }
      setLoading(false);
    }).catch(() => {
      clearTimeout(authTimeout);
      setLoading(false);
    });


    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, supabaseSession) => {
        if (event === 'SIGNED_OUT') {
          // No guard for the password-change revocation here, deliberately.
          // `signOut({ scope: 'others' })` does not touch this device's stored
          // session and never emits SIGNED_OUT locally (auth-js removes the
          // local session only when the scope is NOT 'others'), so a flag
          // suppressing that event was guarding against something that cannot
          // happen — and would have swallowed a real sign-out if it ever stuck.
          isLoggingOutRef.current = false;
          setSession(null);
          setCurrentUser(null);
          localStorage.removeItem('currentUser');
          localStorage.removeItem('meetifyy_recent_searches');
          localStorage.removeItem('meetify_muted_communities');
          localStorage.removeItem('read_invitations');
          localStorage.removeItem('meetify_following_list');
          localStorage.removeItem('meetify_followers_list');
          useSavedPostsStore.getState().clearAll?.();
          useSavedActivitiesStore.getState().clearAll?.();
          usePostStore.getState().clearAll?.();
          idbClearAll().catch(e => console.error('Failed to clear IDB on sign out', e));
          setLoading(false);
          return;
        }

        if (event === 'PASSWORD_RECOVERY') {
          // ─── SECURITY: Do NOT call setSession() here. ─────────────────────
          // A PASSWORD_RECOVERY session is a temporary one-time credential
          // scoped exclusively to the /reset-password page. Broadcasting it
          // into global auth state (isLoggedIn = true) would silently
          // authenticate the user into the full app — a critical security bug.
          //
          // ResetPasswordPage reads this session independently via
          // supabase.auth.getSession() and its own onAuthStateChange listener.
          // ──────────────────────────────────────────────────────────────────
          setLoading(false);
          return;
        }

        // USER_UPDATED fires after supabase.auth.updateUser() — e.g. password change
        // from ResetPasswordPage. At this point the recovery session is about to be
        // signed out by that page. Don't set it into global state.
        if (event === 'USER_UPDATED') {
          setLoading(false);
          return;
        }

        if (isLoggingOutRef.current) {
          setSession(null);
          setCurrentUser(null);
          setLoading(false);
          return;
        }

        // ─── INITIAL_SESSION recovery guard ──────────────────────────────────
        // If PASSWORD_RECOVERY fired before this listener attached, Supabase
        // replays it as INITIAL_SESSION. The recovery flag (written in supabase.js)
        // confirms this is a recovery link tab. Skip ALL auth state updates so
        // ResetPasswordPage handles this session exclusively.
        if (event === 'INITIAL_SESSION') {
          let pendingRecovery = false;
          try { pendingRecovery = sessionStorage.getItem('sb-pwreset-pending') === '1'; } catch {}
          if (pendingRecovery) {
            setLoading(false);
            return;
          }
        }

        setSession(supabaseSession);

        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
          const sbUser = supabaseSession?.user;
          if (sbUser) {
            const optProfile = {
              id: sbUser.id,
              email: sbUser.email || '',
              username: sbUser.user_metadata?.username || '',
              displayName: sbUser.user_metadata?.displayName || sbUser.email?.split('@')[0] || '',
              role: 'Student',
            };
            setCurrentUser(prev => {
              const isFallbackHandle = (str) => !str || typeof str !== 'string' || str.startsWith('user_');
              if (prev && prev.id === sbUser.id && !isFallbackHandle(prev.username) && !isFallbackHandle(prev.displayName)) {
                return prev;
              }
              const validOptUsername = sbUser.user_metadata?.username || (!isFallbackHandle(prev?.username) ? prev.username : '');
              const validOptDisplayName = sbUser.user_metadata?.displayName || (!isFallbackHandle(prev?.displayName) ? prev.displayName : (sbUser.email?.split('@')[0] || ''));
              return {
                ...optProfile,
                username: validOptUsername,
                displayName: validOptDisplayName,
              };
            });
          }

          if (supabaseSession?.user) {
            const now = Date.now();
            if (now - lastSyncAtRef.current >= 5000) {
              if (syncDebounceRef.current) clearTimeout(syncDebounceRef.current);
              syncDebounceRef.current = setTimeout(() => {
                performSync(supabaseSession, event);
              }, 200);
            }
          }
        }
        
        setLoading(false);
      }
    );
    
    return () => subscription.unsubscribe();
  }, [performSync, hydrateFromCookie]);


  const login = useCallback(async (usernameOrEmail, password) => {
    isLoggingOutRef.current = false;
    if (!isSupabaseConfigured) throw new Error('Supabase is not configured.');

    // Single server-side login call. The backend resolves username→email
    // internally (the email is never exposed to the client), authenticates via
    // Supabase, rate-limits brute force, and fires the login-notification email
    // asynchronously. We only receive the session tokens.
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

    const { session } = await res.json();
    const accessToken = session?.access_token;
    const refreshToken = session?.refresh_token;
    if (!accessToken || !refreshToken) {
      throw new Error('Login failed. Please try again.');
    }

    // Install the session into the Supabase client — it takes over persistence
    // and refresh, and fires SIGNED_IN, which drives profile sync in
    // onAuthStateChange.
    const { error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) {
      throw new Error(error.message || 'Login failed. Please try again.');
    }

    return true;
  }, []);

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
      
      localStorage.setItem('currentUser', JSON.stringify(profile));
      setCurrentUser(profile);

      // Clear stale signup session data — the OTP is now used and should not be replayable
      sessionStorage.removeItem('meetifyy_signup_data');

      // Immediately persist gathered profile details to backend database.
      // The backend syncProfile gate will allow this because email_confirmed_at
      // is now set (Supabase marks it on successful OTP verification).
      try {
        const { password, ...safeData } = payloadObj;
        const response = await usersApi.updateProfile({
          ...safeData,
          displayName,
          username,
        });
        const syncedUser = response?.user || response;
        if (syncedUser) {
          profile = { ...profile, ...syncedUser };
          localStorage.setItem('currentUser', JSON.stringify(profile));
          setCurrentUser(profile);
        }
      } catch (err) {
        console.error('Failed to sync profile immediately on OTP verification', err);
      }
    }
    
    return true;
  }, []);

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
  }, [currentUser, isSupabaseConfigured]);

  const logout = useCallback(async () => {
    isLoggingOutRef.current = true;
    setSession(null);
    setCurrentUser(null);
    localStorage.removeItem('currentUser');
    localStorage.removeItem('meetifyy_recent_searches');
    localStorage.removeItem('meetify_muted_communities');
    localStorage.removeItem('read_invitations');
    localStorage.removeItem('meetify_show_community_details');
    localStorage.removeItem('meetify_following_list');
    localStorage.removeItem('meetify_followers_list');
    sessionStorage.removeItem('meetifyy_signup_data');
    useSavedPostsStore.getState().clearAll?.();
    useSavedActivitiesStore.getState().clearAll?.();
    usePostStore.getState().clearAll?.();
    idbClearAll().catch(e => console.error('Failed to clear IDB on logout', e));
    // The React Query cache is memory-only and dies with the page, but the
    // service worker's API cache is not: it is keyed by URL with no regard for
    // who was authenticated when the body was stored. On a shared device the
    // next person to sign in could be served the previous user's cached
    // response offline. Everything the worker holds is re-fetchable, so the
    // safe thing is simply to drop all of it.
    if (typeof caches !== 'undefined') {
      caches.keys()
        .then((names) => Promise.all(names.filter((n) => n.startsWith('meetifyy-api')).map((n) => caches.delete(n))))
        .catch(() => {});
    }
    // Anything the API-origin failover learned belongs to the previous session.
    try { sessionStorage.removeItem('meetifyy_api_failover'); } catch {}

    if (isSupabaseConfigured) {
      try {
        await supabase.auth.signOut();
      } catch (e) {
        console.error('Supabase signOut error', e);
      }
    }
  }, []);

  // Listen to global auth:unauthorized events dispatched from the apiClient
  useEffect(() => {
    const handleUnauthorized = () => {
      logout();
    };
    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => {
      window.removeEventListener('auth:unauthorized', handleUnauthorized);
    };
  }, [logout]);

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
    isLoggedIn, session, loading, currentUser, username, displayName, initial,
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
