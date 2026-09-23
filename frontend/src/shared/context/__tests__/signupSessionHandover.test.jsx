/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup, waitFor } from '@testing-library/react';

/**
 * The end of signup: `verifyOtp` mints a provider session, and two calls hand
 * it to the server.
 *
 * Two defects are pinned here, which together sent a new user on the installed
 * app back to the opening screen at the last step of signup, and left an
 * account that could never sign in:
 *
 *   • The handover calls took their credential from the platform's session
 *     source. The web source happened to have picked the new session up; the
 *     app's source never could. Both calls went out with no credential.
 *
 *   • A failed handover was logged and the user marked signed in anyway, with
 *     no session behind it. The next authenticated request tore that down.
 */

const verifyOtp = vi.hoisted(() => vi.fn());
const adoptSession = vi.hoisted(() => vi.fn());
const updateProfile = vi.hoisted(() => vi.fn());
const forgetProviderSession = vi.hoisted(() => vi.fn());

vi.mock('@shared/lib/supabase', () => ({
  supabase: { auth: { verifyOtp: (...a) => verifyOtp(...a), getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({}) } },
  isSupabaseConfigured: true,
  isRecoveryTab: () => false,
  clearRecoveryTab: () => {},
  forgetProviderSession: (...a) => forgetProviderSession(...a),
}));
vi.mock('@config', () => ({
  IS_MOBILE_BUILD: false,
  config: { supabase: { url: 'https://example.supabase.co', anonKey: 'k' } },
  IS_DEV_BUILD: false,
}));
vi.mock('@shared/api/apiClient', () => ({
  readCsrfCookie: () => '',
  mayHaveCookieSession: () => false,
  rememberCsrfToken: () => {},
  forgetCsrfToken: () => {},
  rememberSessionTokens: async () => {},
  whenSessionReady: () => null,
  forgetSessionTokens: () => {},
  getBackendUrl: () => 'https://api.example',
  apiClient: { post: async () => ({}), get: async () => ({}) },
  usersApi: { updateProfile: (...a) => updateProfile(...a) },
  postsApi: { getBookmarks: async () => ({ posts: [] }) },
  authApi: {
    currentSession: async () => ({}),
    syncProfile: async () => ({ user: null }),
    adoptSession: (...a) => adoptSession(...a),
    logoutSession: async () => ({}),
  },
}));
vi.mock('@tanstack/react-query', async (io) => {
  const actual = await io();
  return { ...actual, useQueryClient: () => ({ clear: () => {}, removeQueries: () => {}, setQueryData: () => {}, invalidateQueries: () => {}, refetchQueries: () => {}, getQueriesData: () => [], setQueriesData: () => {} }) };
});

const { AuthProvider, useAuth, AUTH_STATUS } = await import('@shared/context/AuthContext');

const SESSION = { access_token: 'handover-access', refresh_token: 'handover-refresh' };
const PROVIDER_USER = { id: 'u1', email: 'a@college.edu', user_metadata: {} };

describe('the signup session handover', () => {
  let auth;
  const Probe = () => { auth = useAuth(); return null; };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    verifyOtp.mockResolvedValue({ data: { session: SESSION, user: PROVIDER_USER }, error: null });
    updateProfile.mockResolvedValue({ user: { id: 'u1', username: 'a' } });
    adoptSession.mockResolvedValue({ user: { id: 'u1', username: 'a' }, csrfToken: 'c', sessionId: 's1' });
  });
  afterEach(() => { cleanup(); localStorage.clear(); });

  const mount = async () => {
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(auth.authStatus).toBe(AUTH_STATUS.UNAUTHENTICATED));
  };

  it('authenticates both handover calls with the session verifyOtp returned', async () => {
    await mount();
    await act(async () => {
      await auth.verifySignupOtp('a@college.edu', '123456', { username: 'a', password: 'pw' });
    });

    expect(updateProfile).toHaveBeenCalledWith(
      expect.not.objectContaining({ password: expect.anything() }),
      { bearer: 'handover-access' },
    );
    expect(adoptSession).toHaveBeenCalledWith('handover-refresh', { bearer: 'handover-access' });
    expect(auth.authStatus).toBe(AUTH_STATUS.AUTHENTICATED);
    expect(forgetProviderSession).toHaveBeenCalled();
  });

  it('does not sign the user in when the server did not take the session', async () => {
    adoptSession.mockRejectedValue(Object.assign(new Error('Missing authorization header'), { status: 401 }));
    await mount();

    await act(async () => {
      await expect(
        auth.verifySignupOtp('a@college.edu', '123456', { username: 'a' }),
      ).rejects.toThrow(/verified.*sign in/i);
    });

    expect(auth.authStatus).toBe(AUTH_STATUS.UNAUTHENTICATED);
    expect(localStorage.getItem('loggedIn')).toBeNull();
    // Still dropped: the tab must not keep the provider session either way.
    expect(forgetProviderSession).toHaveBeenCalled();
  });
});
