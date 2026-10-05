/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup, waitFor } from '@testing-library/react';

/**
 * The installed app opens on the account it already holds and checks with the
 * server behind it, instead of holding the splash for two round trips.
 *
 * What must stay true: it only does so with a stored credential AND a saved
 * profile; a session the server refuses is torn down completely; and being
 * offline keeps the cached account, as the old fallback did.
 */

const currentSession = vi.hoisted(() => vi.fn());
const mayHaveCookieSession = vi.hoisted(() => vi.fn());
const forgetSessionTokens = vi.hoisted(() => vi.fn());

vi.mock('@shared/lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({}) } },
  isSupabaseConfigured: true,
  isRecoveryTab: () => false,
  clearRecoveryTab: () => {},
  forgetProviderSession: () => {},
}));
vi.mock('@config', () => ({
  IS_MOBILE_BUILD: true,
  config: { supabase: { url: 'https://example.supabase.co', anonKey: 'k' } },
  IS_DEV_BUILD: false,
}));
vi.mock('@shared/api/apiClient', () => ({
  readCsrfCookie: () => '',
  mayHaveCookieSession: (...a) => mayHaveCookieSession(...a),
  whenSessionReady: () => Promise.resolve(true),
  rememberCsrfToken: () => {},
  forgetCsrfToken: () => {},
  rememberSessionTokens: () => {},
  forgetSessionTokens: (...a) => forgetSessionTokens(...a),
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

const CACHED = { id: 'u1', username: 'sarthak', displayName: 'Sarthak' };
const FRESH = { ...CACHED, displayName: 'Sarthak Saini' };

describe('installed app: local-first boot', () => {
  let auth;
  let seen;
  const Probe = () => { auth = useAuth(); seen.push(auth.authStatus); return null; };
  const ready = vi.fn();

  beforeEach(() => {
    auth = undefined;
    seen = [];
    vi.clearAllMocks();
    localStorage.clear();
    window.__meetifyyBoot = { ready };
  });
  afterEach(() => { cleanup(); localStorage.clear(); delete window.__meetifyyBoot; });

  const holdsAccount = () => {
    mayHaveCookieSession.mockReturnValue(true);
    localStorage.setItem('currentUser', JSON.stringify(CACHED));
    localStorage.setItem('loggedIn', 'true');
  };

  it('opens on the saved account before the server answers, then takes its profile', async () => {
    holdsAccount();
    let answer;
    currentSession.mockReturnValue(new Promise((r) => { answer = r; }));

    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(auth.authStatus).toBe(AUTH_STATUS.AUTHENTICATED));
    expect(auth.currentUser.id).toBe('u1');
    expect(ready).toHaveBeenCalled(); // the splash may lift now

    await act(async () => { answer({ user: FRESH }); });
    await waitFor(() => expect(auth.currentUser.displayName).toBe('Sarthak Saini'));
    expect(seen).not.toContain(AUTH_STATUS.UNAUTHENTICATED);
  });

  it('tears everything down when the server refuses the session', async () => {
    holdsAccount();
    localStorage.setItem('meetifyy_feed_snapshot_v1', '{"userId":"u1"}');
    currentSession.mockRejectedValue(Object.assign(new Error('expired'), { status: 401 }));

    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(auth.authStatus).toBe(AUTH_STATUS.UNAUTHENTICATED));
    expect(auth.currentUser).toBeNull();
    expect(forgetSessionTokens).toHaveBeenCalled();
    expect(localStorage.getItem('currentUser')).toBeNull();
    expect(localStorage.getItem('meetifyy_feed_snapshot_v1')).toBeNull();
  });

  it('stays on the saved account when the server cannot be reached', async () => {
    holdsAccount();
    currentSession.mockRejectedValue(new TypeError('Failed to fetch'));

    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(currentSession).toHaveBeenCalled());
    await act(async () => {});
    expect(auth.authStatus).toBe(AUTH_STATUS.AUTHENTICATED);
    expect(auth.currentUser.id).toBe('u1');
  });

  it('waits for the server when there is no saved profile', async () => {
    mayHaveCookieSession.mockReturnValue(true);
    let answer;
    currentSession.mockReturnValue(new Promise((r) => { answer = r; }));

    render(<AuthProvider><Probe /></AuthProvider>);
    await act(async () => {});
    expect(auth.authStatus).toBe(AUTH_STATUS.INITIALIZING);

    await act(async () => { answer({ user: FRESH }); });
    await waitFor(() => expect(auth.authStatus).toBe(AUTH_STATUS.AUTHENTICATED));
  });

  it('never opens on a saved profile without a stored credential', async () => {
    localStorage.setItem('currentUser', JSON.stringify(CACHED));
    localStorage.setItem('loggedIn', 'true');
    mayHaveCookieSession.mockReturnValue(false);

    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(auth.authStatus).toBe(AUTH_STATUS.UNAUTHENTICATED));
    expect(currentSession).not.toHaveBeenCalled();
  });
});
