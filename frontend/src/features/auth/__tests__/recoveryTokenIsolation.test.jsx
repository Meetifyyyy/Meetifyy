/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * A password-recovery session must never become the token the API client sends.
 *
 * `AuthContext` already refuses to put a recovery session into React state, so
 * the app never renders as signed in on the reset page. The API client had no
 * such guard: it keeps its own token cache fed by its own auth listener, so
 * while a tab sat on /reset-password the recovery credential WAS the
 * Authorization header on every call the client made.
 *
 * A recovery token is an ordinary session JWT — the backend cannot tell it from
 * a login, which is precisely why it must not be handed one. The isolation has
 * to hold on the way out, and it has to survive the two paths that read around
 * the cache: the localStorage fallback and the refresh-on-401.
 */

const RECOVERY = { access_token: 'recovery-token', refresh_token: 'r' };
const NORMAL = { access_token: 'normal-token', refresh_token: 'r' };

let recoveryTab;
let authCallback;
const refreshSession = vi.fn();
const getSession = vi.fn();

vi.mock('@shared/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: (...a) => getSession(...a),
      refreshSession: (...a) => refreshSession(...a),
      onAuthStateChange: (cb) => {
        authCallback = cb;
        return { data: { subscription: { unsubscribe() {} } } };
      },
      signOut: async () => ({}),
    },
  },
  isSupabaseConfigured: true,
  isRecoveryTab: () => recoveryTab,
  clearRecoveryTab: () => { recoveryTab = false; },
}));
vi.mock('@config', () => ({
  config: {
    supabase: { url: 'https://proj.supabase.co', anonKey: 'k' },
    api: { baseUrl: 'http://api.test', proxyPrefix: '/api-proxy' },
  },
  IS_DEV_BUILD: false,
}));
vi.mock('@shared/lib/accountStatusCorrection', () => ({ applyAccountStatusCorrection: () => {} }));
vi.mock('@shared/lib/legalConsent', () => ({
  announceLegalConsentChange: () => {},
  LEGAL_ACK_REQUIRED_CODE: 'LEGAL_ACK_REQUIRED',
}));

/**
 * Loads a fresh copy of the client and returns a probe that reports the
 * Authorization header an actual request would carry.
 *
 * Asserted on the wire rather than on an internal, because the header is the
 * thing that matters: a guard that stops a token being cached but leaves
 * another path putting it on the request has fixed nothing.
 */
async function loadClient() {
  vi.resetModules();
  getSession.mockResolvedValue({ data: { session: null } });
  const mod = await import('@shared/api/apiClient');
  // Let the module's seeding getSession() settle.
  await new Promise((r) => setTimeout(r, 0));

  const authHeaderOf = async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({}),
      text: async () => '{}',
    }));
    vi.stubGlobal('fetch', fetchMock);
    await mod.apiClient.get('/api/auth/anything').catch(() => {});
    const init = fetchMock.mock.calls[0]?.[1];
    vi.unstubAllGlobals();
    return init?.headers?.Authorization ?? null;
  };

  return { ...mod, authHeaderOf };
}

describe('recovery-token isolation in the API client', () => {
  beforeEach(() => {
    recoveryTab = false;
    authCallback = undefined;
    refreshSession.mockReset();
    getSession.mockReset();
    localStorage.clear();
  });
  afterEach(() => { localStorage.clear(); });

  it('sends a normal session token', async () => {
    const { authHeaderOf } = await loadClient();
    authCallback('SIGNED_IN', NORMAL);
    expect(await authHeaderOf()).toBe('Bearer normal-token');
  });

  it('never sends a recovery session token', async () => {
    recoveryTab = true;
    const { authHeaderOf } = await loadClient();
    authCallback('PASSWORD_RECOVERY', RECOVERY);
    expect(await authHeaderOf()).toBeFalsy();
  });

  it('keeps refusing it on the INITIAL_SESSION replay and on refreshes', async () => {
    // PASSWORD_RECOVERY fires once, but the session it establishes lives on
    // through replays and token refreshes — each of which would otherwise cache
    // it. The guard is scoped to the tab, not to the one event.
    recoveryTab = true;
    const { authHeaderOf } = await loadClient();
    authCallback('INITIAL_SESSION', RECOVERY);
    expect(await authHeaderOf()).toBeFalsy();
    authCallback('TOKEN_REFRESHED', RECOVERY);
    expect(await authHeaderOf()).toBeFalsy();
  });

  it('does not read the recovery session back out of localStorage', async () => {
    // The cache falls back to scanning storage when it holds no token, and an
    // empty cache is exactly the state the guard above produces. A recovery
    // session sits in localStorage like any other, so without the same guard
    // there the fallback walks straight around it.
    recoveryTab = true;
    localStorage.setItem(
      'sb-proj-auth-token',
      JSON.stringify({ access_token: 'recovery-token' }),
    );
    const { authHeaderOf } = await loadClient();
    expect(await authHeaderOf()).toBeFalsy();
  });

  it('still reads a normal session out of localStorage', async () => {
    // The fallback exists for a reason — a cold boot before the listener has
    // fired — and the guard must not disable it for everybody.
    localStorage.setItem(
      'sb-proj-auth-token',
      JSON.stringify({ access_token: 'normal-token' }),
    );
    const { authHeaderOf } = await loadClient();
    expect(await authHeaderOf()).toBe('Bearer normal-token');
  });

  it('stops withholding once the recovery session is signed out', async () => {
    // The reset page signs out when it finishes, or when the link turns out to
    // be expired. Past that the tab is ordinary, and continuing to withhold
    // would break every request the user makes after signing back in.
    recoveryTab = true;
    const { authHeaderOf } = await loadClient();
    authCallback('PASSWORD_RECOVERY', RECOVERY);
    expect(await authHeaderOf()).toBeFalsy();

    authCallback('SIGNED_OUT', null);
    authCallback('SIGNED_IN', NORMAL);
    expect(await authHeaderOf()).toBe('Bearer normal-token');
  });
});
