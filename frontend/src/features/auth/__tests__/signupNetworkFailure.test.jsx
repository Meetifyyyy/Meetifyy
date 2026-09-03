/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';

/**
 * The "Next" button on the Setup Password step makes exactly one request:
 * `supabase.auth.signUp`, straight to Supabase Auth. These pin that down, and
 * pin down what the user is told when it fails at the network level.
 */

const signUpMock = vi.fn();
vi.mock('@shared/lib/supabase', () => ({
  supabase: {
    auth: {
      signUp: (...args) => signUpMock(...args),
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({}),
    },
  },
  isSupabaseConfigured: true,
}));
vi.mock('@config', () => ({
  config: { supabase: { url: 'https://gjfiwqpjtzhnqwriwdvi.supabase.co', anonKey: 'k' } },
  IS_DEV_BUILD: false,
}));
vi.mock('@shared/api/apiClient', () => ({
  getBackendUrl: () => 'https://api.meetifyy.app',
  apiClient: { post: async () => ({}), get: async () => ({}) },
}));
vi.mock('@tanstack/react-query', async (io) => {
  const actual = await io();
  return { ...actual, useQueryClient: () => ({ clear: () => {}, removeQueries: () => {}, setQueryData: () => {}, invalidateQueries: () => {}, refetchQueries: () => {} }) };
});

const { AuthProvider, useAuth } = await import('@shared/context/AuthContext');

const VALID = {
  email: 'student@college.edu',
  password: 'a-good-password',
  birthday: '2000-01-01',
  username: 'student',
  firstName: 'Stu',
};

/** Calls initiateSignup and returns whatever it threw or returned. */
function runSignup() {
  const out = {};
  function Probe() {
    const { initiateSignup } = useAuth();
    out.run = () => initiateSignup(VALID);
    return null;
  }
  render(<AuthProvider><Probe /></AuthProvider>);
  return out;
}

const netErr = (message, name = 'TypeError') => Object.assign(new Error(message), { name });

describe('the Next button on the password step', () => {
  beforeEach(() => { signUpMock.mockReset(); vi.stubGlobal('navigator', { onLine: true, userAgent: 'test' }); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('calls Supabase Auth directly, and nothing else', async () => {
    signUpMock.mockResolvedValue({ data: { user: { identities: [{ id: '1' }] } }, error: null });
    const t = runSignup();
    await act(async () => { await t.run(); });
    expect(signUpMock).toHaveBeenCalledTimes(1);
    const [payload] = signUpMock.mock.calls[0];
    expect(payload.email).toBe('student@college.edu');
    expect(payload.password).toBe('a-good-password');
  });

  it('explains a blocked request instead of surfacing "Failed to fetch"', async () => {
    signUpMock.mockRejectedValue(netErr('Failed to fetch'));
    const t = runSignup();
    let thrown;
    await act(async () => { thrown = await t.run().catch((e) => e); });

    expect(thrown.message).not.toBe('Failed to fetch');
    expect(thrown.message).not.toContain('Failed to fetch');
    // Names the host, so a support ticket points at the right system.
    expect(thrown.message).toContain('gjfiwqpjtzhnqwriwdvi.supabase.co');
    // And tells the user their account was not created.
    expect(thrown.message).toContain('Nothing was submitted');
  });

  it('says so plainly when the browser is offline', async () => {
    vi.stubGlobal('navigator', { onLine: false, userAgent: 'test' });
    signUpMock.mockRejectedValue(netErr('Failed to fetch'));
    const t = runSignup();
    let thrown;
    await act(async () => { thrown = await t.run().catch((e) => e); });
    expect(thrown.message).toContain('offline');
  });

  it('passes a real server error through untouched', async () => {
    // A response-bearing error reached Supabase; its message is the useful one
    // and must not be replaced with connectivity advice.
    signUpMock.mockResolvedValue({ data: null, error: { message: 'User already registered', status: 422 } });
    const t = runSignup();
    let thrown;
    await act(async () => { thrown = await t.run().catch((e) => e); });
    expect(thrown.message).toBe('User already registered');
  });

  it('does not retry, so a signup cannot be submitted twice', async () => {
    signUpMock.mockRejectedValue(netErr('Failed to fetch'));
    const t = runSignup();
    await act(async () => { await t.run().catch(() => {}); });
    expect(signUpMock).toHaveBeenCalledTimes(1);
  });
});

describe('the signup deadline', () => {
  beforeEach(() => { signUpMock.mockReset(); vi.stubGlobal('navigator', { onLine: true, userAgent: 'test' }); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('stops waiting on a request that never settles, and says the account was not created', async () => {
    // Supabase sends the confirmation email inside this request, so a stalled
    // mail provider hangs it. Without a deadline the browser waits minutes.
    signUpMock.mockReturnValue(new Promise(() => {}));
    vi.useFakeTimers();
    const t = runSignup();
    const pending = t.run().catch((e) => e);
    await act(async () => { await vi.advanceTimersByTimeAsync(26_000); });
    const thrown = await pending;
    expect(thrown.message).toMatch(/too long/i);
    expect(thrown.message).toContain('not created');
  });

  it('lets a normal, fast signup through untouched', async () => {
    signUpMock.mockResolvedValue({ data: { user: { identities: [{ id: '1' }] } }, error: null });
    const t = runSignup();
    let result;
    await act(async () => { result = await t.run(); });
    expect(result).toBe(true);
  });
});
