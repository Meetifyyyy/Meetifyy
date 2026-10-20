/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, act, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

/**
 * After a reset, ALL of the account's sessions must end and the owner must be
 * emailed. The page has only the recovery token, so it makes ONE call to the
 * server's finalize route with it as a Bearer header. The two calls it used to
 * make were refused by the server and their errors swallowed.
 */

const order = [];
let authCallback = null;

vi.mock('@shared/context/AuthContext', () => ({
  supabase: {
    auth: {
      updateUser: async () => { order.push('updateUser'); return { data: { user: { email: 'a@b.edu' } }, error: null }; },
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: (cb) => { authCallback = cb; return { data: { subscription: { unsubscribe() {} } } }; },
      signOut: async () => { order.push('signOut'); return {}; },
    },
  },
  isSupabaseConfigured: true,
}));
vi.mock('@shared/api/apiClient', () => ({
  readCsrfCookie: () => '',
  mayHaveCookieSession: () => false,
  rememberCsrfToken: () => {},
  forgetCsrfToken: () => {},
  authApi: { currentSession: async () => ({ user: null }), adoptSession: async () => ({}), logoutSession: async () => ({}) },
  getBackendUrl: () => 'http://api.test',
}));

const { default: ResetPasswordPage } = await import('@features/auth/pages/ResetPasswordPage');

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

async function submitReset() {
  const { container } = render(<MemoryRouter><ResetPasswordPage /></MemoryRouter>);
  await act(async () => {
    authCallback?.('PASSWORD_RECOVERY', { access_token: 'recovery-tok' });
    await new Promise((r) => setTimeout(r, 20));
  });
  const inputs = container.querySelectorAll('input[type="password"], input[type="text"]');
  fireEvent.change(inputs[0], { target: { value: 'a-good-password' } });
  fireEvent.change(inputs[1], { target: { value: 'a-good-password' } });
  await act(async () => { container.querySelector('form').requestSubmit(); });
  await settle();
  return container;
}

describe('Reset password finalises server-side', () => {
  let fetchMock;
  beforeEach(() => {
    order.length = 0;
    authCallback = null;
    window.sessionStorage.clear();
    fetchMock = vi.fn(async () => { order.push('finalize'); return { ok: true, status: 200 }; });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('makes exactly one call, to the finalize route, with the recovery token as Bearer', async () => {
    await submitReset();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://api.test/api/auth/password-reset/finalize');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer recovery-tok');
  });

  it('no longer calls the two endpoints the server refused', async () => {
    await submitReset();
    const urls = fetchMock.mock.calls.map((c) => c[0]);
    expect(urls.some((u) => u.includes('events/password-changed'))).toBe(false);
    expect(urls.some((u) => u.includes('sessions/revoke-all'))).toBe(false);
  });

  it('finalises before the recovery session is signed out (the token dies with it)', async () => {
    await submitReset();
    expect(order).toEqual(['updateUser', 'finalize', 'signOut']);
  });

  it('retries once when the call fails, and then succeeds quietly', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 });
    const container = await submitReset();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('Redirecting to login');
  });

  it('tells the user to sign out other devices from settings when both attempts fail, and logs it', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockResolvedValue({ ok: false, status: 401 });
    const container = await submitReset();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('sign out of other devices');
    expect(container.textContent).toContain('Settings');
    expect(error).toHaveBeenCalled();
    // The password did change, so the success screen still shows.
    expect(container.textContent).toContain('Password updated');
  });

  it('treats a network error like a failed attempt', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockRejectedValue(new Error('offline'));
    const container = await submitReset();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('Settings');
  });
});
