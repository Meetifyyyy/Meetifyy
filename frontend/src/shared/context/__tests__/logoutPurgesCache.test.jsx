/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';

/**
 * Signing out has to empty the server-data cache, and it did not.
 *
 * Everything else a session left behind was already being cleared — the cached
 * profile, the saved-activities store, the IndexedDB message cache, the service
 * worker's API cache. The React Query cache was not, and it is the largest
 * thing in the browser holding one person's data: the feed, conversations,
 * notifications, profiles, every list any screen had opened.
 *
 * With `staleTime: 30s` and `gcTime: 15min` (see main.jsx) that cache answers
 * from memory on mount. So on a shared machine the next person to sign in could
 * be rendered the previous person's data for as long as it took each query to
 * refetch, and nothing in the UI distinguishes a cached answer from a fresh
 * one.
 *
 * The same reasoning covers the account-switch path: adopting a DIFFERENT user
 * id in a browser that was holding one is the same event from the cache's point
 * of view.
 */

const currentSession = vi.hoisted(() => vi.fn());
const clearSpy = vi.hoisted(() => vi.fn());
const logoutSession = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());

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
  forgetSessionTokens: () => {},
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

/** `login` posts with raw fetch, so that is what has to be stubbed. */
const loginResponse = (body, ok = true, status = 200) => ({ ok, status, json: async () => body });

const USER_A = { id: 'a1', username: 'alice', displayName: 'Alice' };
const USER_B = { id: 'b2', username: 'bob', displayName: 'Bob' };

describe('signing out empties the server-data cache', () => {
  let auth;
  const Probe = () => {
    auth = useAuth();
    return null;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    currentSession.mockResolvedValue({ user: USER_A, meta: {} });
    logoutSession.mockResolvedValue({});
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(loginResponse({ user: USER_A, csrfToken: 'c1', meta: {} }));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  const mount = async () => {
    await act(async () => {
      render(
        <AuthProvider>
          <Probe />
        </AuthProvider>,
      );
    });
  };

  it('clears the query cache on logout', async () => {
    await mount();
    await act(async () => { await auth.login('alice', 'pw'); });
    clearSpy.mockClear();

    await act(async () => { await auth.logout(); });

    expect(clearSpy).toHaveBeenCalled();
  });

  it('clears the query cache when a different account is adopted', async () => {
    // A shared machine where the second person signs in without the first
    // having signed out. From the cache's point of view this is the same event.
    await mount();
    await act(async () => { await auth.login('alice', 'pw'); });
    clearSpy.mockClear();

    fetchMock.mockResolvedValue(loginResponse({ user: USER_B, csrfToken: 'c2', meta: {} }));
    await act(async () => { await auth.login('bob', 'pw'); });

    expect(clearSpy).toHaveBeenCalled();
  });

  it('does NOT clear the cache when the same account is re-adopted', async () => {
    // A session refresh or a cross-tab sync re-adopts the same user. Throwing
    // the cache away there would make every open screen refetch for no reason.
    await mount();
    await act(async () => { await auth.login('alice', 'pw'); });
    clearSpy.mockClear();

    fetchMock.mockResolvedValue(loginResponse({ user: { ...USER_A, displayName: 'Alice Renamed' }, csrfToken: 'c1', meta: {} }));
    await act(async () => { await auth.login('alice', 'pw'); });

    expect(clearSpy).not.toHaveBeenCalled();
  });

  it('still clears locally when the server sign-out call fails', async () => {
    // Being unable to reach the server is not a reason to leave one person's
    // data in the browser for the next one.
    logoutSession.mockRejectedValue(new Error('offline'));
    {
      await mount();
      await act(async () => { await auth.login('alice', 'pw'); });
      clearSpy.mockClear();

      await act(async () => { await auth.logout(); });

      expect(clearSpy).toHaveBeenCalled();
    }
  });
});
