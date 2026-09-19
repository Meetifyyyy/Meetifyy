/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup, waitFor } from '@testing-library/react';

/**
 * The boot sequence, and the two bugs it exists to prevent.
 *
 * 1. A signed-in browser was shown the landing page for a moment on every
 *    refresh. `loading` was cleared by the provider's auth listener the instant
 *    it saw `INITIAL_SESSION` — which fires with a null session on every reload,
 *    because the provider session lives in memory — while the cookie probe was
 *    still in flight. The router was handed "not signed in" as though it were
 *    final, and did the only thing it could with it.
 *
 * 2. The probe was skipped entirely whenever `document.cookie` could not see
 *    `mf_csrf`, which is every deployment where the API is host-only on its own
 *    hostname. On those, a valid session was never restored at all.
 */

const currentSession = vi.hoisted(() => vi.fn());
const mayHaveCookieSession = vi.hoisted(() => vi.fn());
const syncProfile = vi.hoisted(() => vi.fn());

vi.mock('@shared/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({}),
      updateUser: async () => ({}),
    },
  },
  isSupabaseConfigured: true,
  isRecoveryTab: () => false,
  clearRecoveryTab: () => {},
}));
vi.mock('@config', () => ({
  config: { supabase: { url: 'https://example.supabase.co', anonKey: 'k' } },
  IS_DEV_BUILD: false,
}));
vi.mock('@shared/api/apiClient', () => ({
  readCsrfCookie: () => '',
  mayHaveCookieSession: (...a) => mayHaveCookieSession(...a),
  rememberCsrfToken: () => {},
  forgetCsrfToken: () => {},
  getBackendUrl: () => 'https://api.example',
  apiClient: { post: async () => ({}), get: async () => ({}) },
  usersApi: {},
  postsApi: { getBookmarks: async () => ({ posts: [] }) },
  authApi: {
    currentSession: (...a) => currentSession(...a),
    syncProfile: (...a) => syncProfile(...a),
    adoptSession: async () => ({}),
    logoutSession: async () => ({}),
  },
}));
vi.mock('@tanstack/react-query', async (io) => {
  const actual = await io();
  return {
    ...actual,
    useQueryClient: () => ({
      clear: () => {}, removeQueries: () => {}, setQueryData: () => {},
      invalidateQueries: () => {}, refetchQueries: () => {}, getQueriesData: () => [],
      setQueriesData: () => {},
    }),
  };
});

const { AuthProvider, useAuth, AUTH_STATUS } = await import('@shared/context/AuthContext');

const USER = { id: 'u1', username: 'sarthak', displayName: 'Sarthak Saini' };

describe('auth initialization', () => {
  let seen;
  let auth;

  const Probe = () => {
    auth = useAuth();
    seen.push(auth.authStatus);
    return null;
  };

  beforeEach(() => {
    seen = [];
    auth = undefined;
    vi.clearAllMocks();
    localStorage.clear();
  });
  afterEach(() => { cleanup(); localStorage.clear(); });

  it('never reports "unauthenticated" while the session probe is still in flight', async () => {
    mayHaveCookieSession.mockReturnValue(true);
    let resolveProbe;
    currentSession.mockReturnValue(new Promise((r) => { resolveProbe = r; }));

    render(<AuthProvider><Probe /></AuthProvider>);
    await act(async () => {});

    // This is the assertion the flicker was: the only status the router may see
    // before the answer arrives is `initializing`.
    expect(seen.every((s) => s === AUTH_STATUS.INITIALIZING)).toBe(true);
    expect(auth.isLoggedIn).toBe(false);
    expect(auth.loading).toBe(true);

    await act(async () => { resolveProbe({ user: USER }); });
    await waitFor(() => expect(auth.authStatus).toBe(AUTH_STATUS.AUTHENTICATED));
    expect(seen).not.toContain(AUTH_STATUS.UNAUTHENTICATED);
  });

  it('restores a cookie session even when mf_csrf is unreadable from this page', async () => {
    // `readCsrfCookie` returns '' above, as it does whenever the API's cookies
    // are host-only on another hostname. The probe must still run.
    mayHaveCookieSession.mockReturnValue(true);
    currentSession.mockResolvedValue({ user: USER });

    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(auth.authStatus).toBe(AUTH_STATUS.AUTHENTICATED));

    expect(currentSession).toHaveBeenCalled();
    expect(auth.currentUser.id).toBe('u1');
  });

  it('settles on "unauthenticated" and clears the cached profile when the server refuses', async () => {
    localStorage.setItem('currentUser', JSON.stringify(USER));
    localStorage.setItem('loggedIn', 'true');
    mayHaveCookieSession.mockReturnValue(true);
    currentSession.mockRejectedValue(Object.assign(new Error('nope'), { status: 401 }));

    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(auth.authStatus).toBe(AUTH_STATUS.UNAUTHENTICATED));

    // A cached profile left behind is what renders a signed-in-looking shell to
    // somebody the server has just refused.
    expect(localStorage.getItem('currentUser')).toBeNull();
    expect(localStorage.getItem('loggedIn')).toBeNull();
  });

  it('keeps the session when the server could not be asked, rather than inventing a sign-out', async () => {
    // A shared campus NAT spending its burst budget, a 502 mid-deploy, a
    // request that timed out. None of these say anything about whether the
    // session is valid, and answering "signed out" to them logs out a user
    // whose cookies are still perfectly good. The server still authorizes every
    // request that follows, so a browser that is wrong finds out at once.
    localStorage.setItem('currentUser', JSON.stringify(USER));
    localStorage.setItem('loggedIn', 'true');
    mayHaveCookieSession.mockReturnValue(true);
    currentSession.mockRejectedValue(
      Object.assign(new Error('rate limited'), { status: 429 }),
    );

    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(auth.authStatus).toBe(AUTH_STATUS.AUTHENTICATED));
    expect(auth.currentUser.id).toBe('u1');
  });

  it('signs out on an unreachable server when there is no cached profile to fall back to', async () => {
    localStorage.setItem('loggedIn', 'true');
    mayHaveCookieSession.mockReturnValue(true);
    currentSession.mockRejectedValue(new TypeError('Failed to fetch'));

    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(auth.authStatus).toBe(AUTH_STATUS.UNAUTHENTICATED));
  });

  it('falls back to the old sync route while the API is still the previous build', async () => {
    // The app and the API deploy independently, and the backend is the slower
    // of the two — so for a few minutes after a merge the new frontend talks to
    // an API that does not have GET /api/auth/session yet. Without the
    // fallback, every reload in that window signs the user out.
    mayHaveCookieSession.mockReturnValue(true);
    currentSession.mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }));
    syncProfile.mockResolvedValue({ user: USER });

    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(auth.authStatus).toBe(AUTH_STATUS.AUTHENTICATED));

    expect(syncProfile).toHaveBeenCalled();
    expect(auth.currentUser.id).toBe('u1');
  });

  it('does not mistake a 401 for a missing route', async () => {
    mayHaveCookieSession.mockReturnValue(true);
    currentSession.mockRejectedValue(Object.assign(new Error('nope'), { status: 401 }));

    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(auth.authStatus).toBe(AUTH_STATUS.UNAUTHENTICATED));

    expect(syncProfile).not.toHaveBeenCalled();
  });

  it('does not spend a request when nothing suggests a session', async () => {
    mayHaveCookieSession.mockReturnValue(false);

    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(auth.authStatus).toBe(AUTH_STATUS.UNAUTHENTICATED));

    expect(currentSession).not.toHaveBeenCalled();
  });

  it('releases the launch shell once, and only after the answer is known', async () => {
    const ready = vi.fn();
    window.__meetifyyBoot = { ready };
    mayHaveCookieSession.mockReturnValue(true);
    let resolveProbe;
    currentSession.mockReturnValue(new Promise((r) => { resolveProbe = r; }));

    render(<AuthProvider><Probe /></AuthProvider>);
    await act(async () => {});
    expect(ready).not.toHaveBeenCalled();

    await act(async () => { resolveProbe({ user: USER }); });
    await waitFor(() => expect(ready).toHaveBeenCalled());
  });
});
