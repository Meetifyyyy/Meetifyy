/**
 * The auth calls a signed-out visitor has to be able to make.
 *
 * `apiClient` refuses any request whose path is not on its public allowlist
 * BEFORE a byte reaches the network — it throws "Unauthorized: Missing access
 * token". That is the right default, but it means moving an auth call behind
 * our API is only half the job: a route that is unauthenticated on the server
 * and missing from this list fails for exactly the people who need it, and
 * fails in the browser where no server log will ever show it.
 *
 * This nearly happened when the password-reset request moved here. Pinned so
 * the next route to move does not have to rediscover it.
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
  ])('allows %s (%s)', async (path) => {
    expect(await isAllowedWithoutSession(path)).toBe(true);
  });

  it('still refuses an authenticated route with no session', async () => {
    // The allowlist has to stay an allowlist. If this passes, the guard is off
    // and every assertion above is meaningless.
    expect(await isAllowedWithoutSession('/api/auth/verify-password')).toBe(false);
    expect(await isAllowedWithoutSession('/api/auth/sync')).toBe(false);
  });
});
