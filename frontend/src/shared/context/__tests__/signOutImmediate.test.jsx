/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';

/**
 * Signing out is immediate, and it does not become a deep link.
 *
 * `logout` used to await the server revocation before touching local state, so
 * the signed-in UI stayed on screen for the whole round trip, and the sign-out
 * left the app mounted on the page it was triggered from (Settings), where the
 * route guard recorded that page as the post-login destination.
 */

const currentSession = vi.hoisted(() => vi.fn());
const clearSpy = vi.hoisted(() => vi.fn());
const logoutSession = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());
const mediaClearSpy = vi.hoisted(() => vi.fn());
const forgetTokens = vi.hoisted(() => vi.fn());

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
vi.mock('@shared/utils/MediaCacheManager', () => ({
  mediaCache: { clear: (...a) => mediaClearSpy(...a) },
}));
vi.mock('@config', () => ({
  // `false` because these exercise the WEB client. The constant gates which
  // API origin apiClient assembles, and a mock that omits it fails the import
  // outright rather than defaulting — which is how these tests found it.
  IS_MOBILE_BUILD: false,
  config: { supabase: { url: 'https://example.supabase.co', anonKey: 'k' } },
  IS_DEV_BUILD: false,
}));
vi.mock('@shared/api/apiClient', () => ({
  readCsrfCookie: () => '',
  mayHaveCookieSession: () => false,
  rememberCsrfToken: () => {},
  forgetCsrfToken: () => {},
  // Native-only in real use; the web build's are no-ops. Present here because
  // AuthContext awaits one of them on the login path.
  rememberSessionTokens: async () => {},
  // Web's is null: its session is a cookie, so there is nothing to load.
  whenSessionReady: () => null,
  forgetSessionTokens: (...a) => forgetTokens(...a),
  getBackendUrl: () => 'https://api.example',
  apiClient: { post: async () => ({}), get: async () => ({}) },
  usersApi: {},
  postsApi: {},
  authApi: {
    currentSession: (...a) => currentSession(...a),
    syncProfile: async () => ({}),
    adoptSession: async () => ({}),
    logoutSession: (...a) => logoutSession(...a),
  },
}));

/**
 * One stable client object, unlike a fresh literal per call.
 *
 * That distinction is not cosmetic: an earlier version of this change put the
 * client in a `useCallback` dependency array, and a mock returning a new object
 * per render turned that into an infinite re-render. The provider now holds it
 * in a ref for exactly that reason, and this mock is stable so the test is
 * asserting the purge rather than the dependency shape.
 */
const queryClient = {
  clear: (...a) => clearSpy(...a),
  removeQueries: () => {},
  setQueryData: () => {},
  invalidateQueries: () => {},
  refetchQueries: () => {},
  getQueriesData: () => [],
  setQueriesData: () => {},
};
vi.mock('@tanstack/react-query', async (io) => ({
  ...(await io()),
  useQueryClient: () => queryClient,
}));

const { AuthProvider, useAuth } = await import('@shared/context/AuthContext');
const { setRedirectIntent, consumeRedirectIntent, clearRedirectIntent } = await import('@shared/utils/redirectIntent');

const loginResponse = (body, ok = true, status = 200) => ({ ok, status, json: async () => body });
const USER_A = { id: 'a1', username: 'alice', displayName: 'Alice' };
const USER_B = { id: 'b2', username: 'bob', displayName: 'Bob' };

describe('sign-out', () => {
  let auth;
  const Probe = () => { auth = useAuth(); return null; };

  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    currentSession.mockResolvedValue({ user: USER_A, meta: {} });
    logoutSession.mockResolvedValue({});
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(loginResponse({ user: USER_A, csrfToken: 'c1', meta: {} }));
    await act(async () => { render(<AuthProvider><Probe /></AuthProvider>); });
    await act(async () => { await auth.login('alice', 'pw'); });
    forgetTokens.mockClear();
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); sessionStorage.clear(); clearRedirectIntent(); });

  it('signs the UI out immediately, without waiting for the server', async () => {
    let finish;
    logoutSession.mockReturnValue(new Promise((resolve) => { finish = resolve; })); // never answers on its own
    expect(auth.isLoggedIn).toBe(true);

    await act(async () => { auth.logout(); });

    expect(auth.isLoggedIn).toBe(false);
    expect(auth.currentUser).toBeNull();
    expect(logoutSession).toHaveBeenCalledTimes(1);
    await act(async () => { finish({}); });
  });

  it('keeps the credentials until the revocation has settled, then forgets them', async () => {
    let finish;
    logoutSession.mockReturnValue(new Promise((resolve) => { finish = resolve; }));

    await act(async () => { auth.logout(); });
    expect(forgetTokens).not.toHaveBeenCalled(); // the request may still need them

    await act(async () => { finish({}); });
    expect(forgetTokens).toHaveBeenCalledTimes(1);
  });

  it('forgets the credentials even when the server call fails', async () => {
    logoutSession.mockRejectedValue(new Error('offline'));
    await act(async () => { await auth.logout(); });
    expect(auth.isLoggedIn).toBe(false);
    expect(forgetTokens).toHaveBeenCalledTimes(1);
  });

  it('does not destroy the credentials of a session that started while sign-out was finishing', async () => {
    let finish;
    logoutSession.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    await act(async () => { auth.logout(); });

    fetchMock.mockResolvedValue(loginResponse({ user: USER_B, csrfToken: 'c2', meta: {} }));
    await act(async () => { await auth.login('bob', 'pw'); });
    forgetTokens.mockClear();

    await act(async () => { finish({}); });
    expect(forgetTokens).not.toHaveBeenCalled();
    expect(auth.currentUser?.id).toBe('b2');
  });

  it('does not store the page it was triggered from as the next login destination', async () => {
    await act(async () => { await auth.logout(); });

    // What the protected-route guard does when it renders signed out on /settings.
    setRedirectIntent('/settings');

    expect(consumeRedirectIntent()).toBeNull();
  });

  it('records deep links again after the next sign-in ends and a visitor arrives signed out', async () => {
    await act(async () => { await auth.logout(); });
    fetchMock.mockResolvedValue(loginResponse({ user: USER_A, csrfToken: 'c3', meta: {} }));
    await act(async () => { await auth.login('alice', 'pw'); });
    // Signed in: nothing suppressed; a later cold visit behaves as before.
    setRedirectIntent('/post/9');
    expect(consumeRedirectIntent()).toBe('/post/9');
  });
});
