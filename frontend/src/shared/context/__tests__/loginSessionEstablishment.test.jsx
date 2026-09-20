/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup, waitFor } from '@testing-library/react';

/**
 * Signing in must not depend on a second request succeeding.
 *
 * `login` used to POST the credentials and then immediately ask the server who
 * it had just signed in as, treating any failure of THAT call as a failed
 * login. It is not one: by then the credentials have been accepted, the
 * session row exists and the cookies are set. A slow phone or a rate-limited
 * moment in between produced an error on a sign-in that had entirely
 * succeeded — and the message named browser session handling, which is not
 * something a user should be reading about.
 */

const currentSession = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('@shared/lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({}), updateUser: async () => ({}) } },
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
  forgetSessionTokens: () => {},
  getBackendUrl: () => 'https://api.example',
  apiClient: { post: async () => ({}), get: async () => ({}) },
  usersApi: {},
  postsApi: { getBookmarks: async () => ({ posts: [] }) },
  authApi: {
    currentSession: (...a) => currentSession(...a),
    syncProfile: async () => ({ user: null }),
    adoptSession: async () => ({}),
    logoutSession: async () => ({}),
  },
}));
vi.mock('@tanstack/react-query', async (io) => {
  const actual = await io();
  return { ...actual, useQueryClient: () => ({ clear: () => {}, removeQueries: () => {}, setQueryData: () => {}, invalidateQueries: () => {}, refetchQueries: () => {}, getQueriesData: () => [], setQueriesData: () => {} }) };
});

const { AuthProvider, useAuth, AUTH_STATUS } = await import('@shared/context/AuthContext');

const USER = { id: 'u1', username: 'sarthak', displayName: 'Sarthak Saini' };

const loginResponse = (body, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => body,
});

describe('signing in', () => {
  let auth;
  const Probe = () => { auth = useAuth(); return null; };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

  const mount = async () => {
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(auth.authStatus).toBe(AUTH_STATUS.UNAUTHENTICATED));
  };

  it('signs in from the login response alone, with no follow-up request', async () => {
    fetchMock.mockResolvedValue(loginResponse({ user: USER, csrfToken: 'c1', meta: {} }));
    await mount();

    await act(async () => { await auth.login('sarthak', 'pw'); });

    await waitFor(() => expect(auth.authStatus).toBe(AUTH_STATUS.AUTHENTICATED));
    expect(auth.currentUser.id).toBe('u1');
    // The whole point: no second round trip to race.
    expect(currentSession).not.toHaveBeenCalled();
  });

  it('does not fail the sign-in when a follow-up probe would have failed', async () => {
    // The exact regression: the session is fine, the probe is not.
    fetchMock.mockResolvedValue(loginResponse({ user: USER, csrfToken: 'c1' }));
    currentSession.mockRejectedValue(Object.assign(new Error('rate limited'), { status: 429 }));
    await mount();

    await act(async () => { await expect(auth.login('sarthak', 'pw')).resolves.toBe(true); });
    await waitFor(() => expect(auth.authStatus).toBe(AUTH_STATUS.AUTHENTICATED));
  });

  it('falls back to the probe when the API does not return a profile yet', async () => {
    // An API deployed before login started carrying the profile.
    fetchMock.mockResolvedValue(loginResponse({ csrfToken: 'c1' }));
    currentSession.mockResolvedValue({ user: USER });
    await mount();

    await act(async () => { await auth.login('sarthak', 'pw'); });

    await waitFor(() => expect(auth.authStatus).toBe(AUTH_STATUS.AUTHENTICATED));
    expect(currentSession).toHaveBeenCalled();
  });

  it('surfaces the server message for bad credentials', async () => {
    fetchMock.mockResolvedValue(
      loginResponse({ message: 'Invalid username/email or password.' }, false, 401),
    );
    await mount();

    await act(async () => {
      await expect(auth.login('sarthak', 'wrong')).rejects.toThrow(
        'Invalid username/email or password.',
      );
    });
    expect(auth.authStatus).toBe(AUTH_STATUS.UNAUTHENTICATED);
  });

  it('never tells the user about session storage, tokens or browsers', async () => {
    // Only a genuinely unrecoverable case reaches this, and it must not
    // describe a mechanism.
    fetchMock.mockResolvedValue(loginResponse({ csrfToken: 'c1' }));
    currentSession.mockResolvedValue({ user: null });
    await mount();

    let message = '';
    await act(async () => {
      await auth.login('sarthak', 'pw').catch((e) => { message = e.message; });
    });

    expect(message).toBe('Something went wrong. Please try again.');
    expect(message).not.toMatch(/session|browser|token|cookie|storage|supabase/i);
  });
});
