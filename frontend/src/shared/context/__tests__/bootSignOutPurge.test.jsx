/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup, waitFor } from '@testing-library/react';

/**
 * The boot sequence purges the previous account's client state only when the
 * SERVER said the session is over, and only when a previous account is
 * actually recorded on this device.
 *
 * A session that ended while the app was closed never ran `clearLocalSession`,
 * so its caches are still on disk; the next person to sign in would be seeded
 * from them. But "this launch could not tell" is not "signed out": on the
 * installed app an unreadable credential reaches the `mayHaveCookieSession()`
 * gate with the session still valid, and purging there emptied every cache for
 * a user who was back in on the next launch.
 */

const currentSession = vi.hoisted(() => vi.fn());
const mayHaveCookieSession = vi.hoisted(() => vi.fn());
const whenSessionReady = vi.hoisted(() => vi.fn());
const clearSpy = vi.hoisted(() => vi.fn());
const idbClearAll = vi.hoisted(() => vi.fn());
const idbClearMessages = vi.hoisted(() => vi.fn());

vi.mock('@shared/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({}),
    },
  },
  isSupabaseConfigured: true,
  isRecoveryTab: () => false,
  clearRecoveryTab: () => {},
  forgetProviderSession: () => {},
}));
vi.mock('@config', () => ({
  IS_MOBILE_BUILD: false,
  config: { supabase: { url: 'https://example.supabase.co', anonKey: 'k' } },
  IS_DEV_BUILD: false,
}));
vi.mock('@shared/lib/idb', () => ({
  idbClearAll: (...a) => idbClearAll(...a),
}));
vi.mock('@features/messages/shared/utils/idbMessages', () => ({
  idbClearMessages: (...a) => idbClearMessages(...a),
}));
vi.mock('@shared/api/apiClient', () => ({
  readCsrfCookie: () => '',
  mayHaveCookieSession: (...a) => mayHaveCookieSession(...a),
  whenSessionReady: (...a) => whenSessionReady(...a),
  rememberCsrfToken: () => {},
  forgetCsrfToken: () => {},
  rememberSessionTokens: async () => {},
  forgetSessionTokens: () => {},
  getBackendUrl: () => 'https://api.example',
  apiClient: { post: async () => ({}), get: async () => ({}) },
  usersApi: {},
  postsApi: { getBookmarks: async () => ({ posts: [] }) },
  authApi: {
    currentSession: (...a) => currentSession(...a),
    syncProfile: async () => ({}),
    adoptSession: async () => ({}),
    logoutSession: async () => ({}),
  },
}));

/** Stable, so the provider's ref holds one object across renders. */
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

const { AuthProvider, useAuth, AUTH_STATUS } = await import('@shared/context/AuthContext');

const HELD = { id: 'u1', username: 'alice', displayName: 'Alice' };

describe('boot: signed-out purge', () => {
  let auth;
  const Probe = () => { auth = useAuth(); return null; };

  beforeEach(() => {
    auth = undefined;
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    idbClearAll.mockResolvedValue(undefined);
    idbClearMessages.mockResolvedValue(undefined);
    whenSessionReady.mockReturnValue(null);
  });
  afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); });

  const holdAccount = () => {
    localStorage.setItem('currentUser', JSON.stringify(HELD));
    localStorage.setItem('loggedIn', 'true');
    // Session-scoped keys the previous account left behind.
    localStorage.setItem('meetifyy_recent_searches', '["alice search"]');
    localStorage.setItem('meetify_following_list', '["bob"]');
    localStorage.setItem('meetifyy_last_socket_sync', '2026-10-01T00:00:00Z');
  };

  const boot = async () => {
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(auth.authStatus).toBe(AUTH_STATUS.UNAUTHENTICATED));
    // Let the lazy message-cache import settle.
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  };

  it('purges the held account when the server answers signed-out', async () => {
    holdAccount();
    mayHaveCookieSession.mockReturnValue(true);
    currentSession.mockResolvedValue({ user: null });

    await boot();

    expect(currentSession).toHaveBeenCalled();
    expect(clearSpy).toHaveBeenCalled();
    expect(idbClearAll).toHaveBeenCalled();
    await waitFor(() => expect(idbClearMessages).toHaveBeenCalled());
    for (const key of ['currentUser', 'loggedIn', 'meetifyy_recent_searches', 'meetify_following_list', 'meetifyy_last_socket_sync']) {
      expect(localStorage.getItem(key), key).toBeNull();
    }
  });

  it('purges the held account when the server refuses the session with a 401', async () => {
    holdAccount();
    mayHaveCookieSession.mockReturnValue(true);
    currentSession.mockRejectedValue(Object.assign(new Error('expired'), { status: 401 }));

    await boot();

    expect(clearSpy).toHaveBeenCalled();
    expect(idbClearAll).toHaveBeenCalled();
    expect(localStorage.getItem('meetifyy_recent_searches')).toBeNull();
  });

  it('does not purge for a first-time visitor with nothing stored', async () => {
    mayHaveCookieSession.mockReturnValue(true);
    currentSession.mockResolvedValue({ user: null });

    await boot();

    expect(currentSession).toHaveBeenCalled();
    expect(clearSpy).not.toHaveBeenCalled();
    expect(idbClearAll).not.toHaveBeenCalled();
    expect(idbClearMessages).not.toHaveBeenCalled();
  });

  it('does not purge caches when the credential could not be read (no session signal)', async () => {
    holdAccount();
    // A Keystore read that fails during a background pre-start: the credential
    // is unreadable, so the gate below finds no session signal. The session may
    // still be valid; this launch simply could not tell.
    whenSessionReady.mockRejectedValue(new Error('keystore unavailable'));
    mayHaveCookieSession.mockReturnValue(false);

    await boot();

    expect(currentSession).not.toHaveBeenCalled();
    expect(clearSpy).not.toHaveBeenCalled();
    expect(idbClearAll).not.toHaveBeenCalled();
    expect(idbClearMessages).not.toHaveBeenCalled();
    // Other session-scoped state is kept for the user who is back next launch.
    expect(localStorage.getItem('meetifyy_recent_searches')).toBe('["alice search"]');
    expect(localStorage.getItem('meetifyy_last_socket_sync')).toBe('2026-10-01T00:00:00Z');
    // The signed-in markers are still dropped, as before.
    expect(localStorage.getItem('currentUser')).toBeNull();
    expect(localStorage.getItem('loggedIn')).toBeNull();
  });

  it('does not purge on a password-recovery tab', async () => {
    holdAccount();
    sessionStorage.setItem('sb-pwreset-pending', '1');
    mayHaveCookieSession.mockReturnValue(true);

    await boot();

    expect(currentSession).not.toHaveBeenCalled();
    expect(clearSpy).not.toHaveBeenCalled();
    expect(idbClearAll).not.toHaveBeenCalled();
    expect(localStorage.getItem('meetifyy_recent_searches')).toBe('["alice search"]');
  });
});
