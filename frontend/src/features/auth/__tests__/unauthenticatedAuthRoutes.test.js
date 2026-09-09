/**
 * The auth calls a signed-out visitor has to be able to make.
 *
 * `apiClient` used to refuse any path outside its public allowlist before a
 * byte reached the network, so moving an auth call behind our API was only half
 * the job: a route unauthenticated on the server but missing from the list
 * failed for exactly the people who needed it, in the browser, where no server
 * log would ever show it. That nearly happened when the password-reset request
 * moved here.
 *
 * The refusal is gone — with the session in an HttpOnly cookie the client can
 * no longer tell whether it has one, so refusing locally would have blocked
 * every authenticated request the moment tokens stopped being readable. It was
 * never the security control anyway; JwtGuard is, and it is untouched. What is
 * still worth pinning is that these paths reach the network at all, and that
 * every request carries the cookie the server authorizes with.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@shared/lib/supabase', () => ({
  supabase: null,
  isSupabaseConfigured: false,
  isRecoveryTab: () => false,
  clearRecoveryTab: () => {},
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

const { apiClient } = await import('@shared/api/apiClient');

/** Whether the client is willing to send this path with no session at all. */
async function isAllowedWithoutSession(path) {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({}),
    text: async () => '{}',
  }));
  vi.stubGlobal('fetch', fetchMock);
  let refused = false;
  try {
    await apiClient.post(path, {});
  } catch (err) {
    refused = /missing access token/i.test(err?.message || '');
  }
  vi.unstubAllGlobals();
  return !refused;
}

describe('auth routes reachable without a session', () => {
  it.each([
    // Every step of signup happens before the account has a session.
    ['/api/auth/signup', 'the signup proxy'],
    ['/api/auth/signup/resend', 'the confirmation-code resend'],
    // Someone locked out of their account is signed out by definition.
    ['/api/auth/request-password-reset', 'the password-reset request'],
    ['/api/auth/account-exists', 'the account lookup'],
    ['/api/auth/login', 'login'],
    ['/api/auth/check-username', 'the username availability check'],
    ['/api/auth/check-email', 'the email availability check'],
    // "Bring Meetifyy to your campus": the person asking for their college to
    // be added has no account yet, which is the whole point of the form.
    ['/api/auth/request-college', 'the campus access request'],
  ])('allows %s (%s)', async (path) => {
    expect(await isAllowedWithoutSession(path)).toBe(true);
  });

  /**
   * Authenticated routes are now SENT rather than refused locally, because the
   * credential is a cookie this code cannot see. The server decides, and a
   * request with no valid cookie comes back 401.
   */
  it.each(['/api/auth/verify-password', '/api/auth/sync'])(
    'sends %s and lets the server authorize it',
    async (path) => {
      expect(await isAllowedWithoutSession(path)).toBe(true);
    },
  );

  /**
   * The replacement guarantee, and the one that matters now: if the request
   * did not carry credentials, the cookie would never arrive and every
   * authenticated call would 401 no matter who was signed in.
   */
  it('sends every request with credentials, so the session cookie travels', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({}),
      text: async () => '{}',
    }));
    vi.stubGlobal('fetch', fetchMock);
    await apiClient.post('/api/auth/sync', {});
    vi.unstubAllGlobals();

    expect(fetchMock).toHaveBeenCalled();
    expect(fetchMock.mock.calls[0][1].credentials).toBe('include');
  });
});
