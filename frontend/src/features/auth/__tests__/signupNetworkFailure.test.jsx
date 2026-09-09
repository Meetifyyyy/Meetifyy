/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';

/**
 * The "Next" button on the Setup Password step makes exactly one request:
 * `POST /api/auth/signup`, to our own API.
 *
 * It used to go straight to `supabase.auth.signUp`, which meant it passed
 * through nothing of ours and could not be rate-limited — on an endpoint that
 * sends mail out of a budget shared by every user of the project. These pin the
 * route down, and pin down what the user is told when it fails.
 */

const postMock = vi.fn();
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
  isRecoveryTab: () => false,
  clearRecoveryTab: () => {},
}));
vi.mock('@config', () => ({
  config: { supabase: { url: 'https://gjfiwqpjtzhnqwriwdvi.supabase.co', anonKey: 'k' } },
  IS_DEV_BUILD: false,
}));
vi.mock('@shared/api/apiClient', () => ({
  // Added with the cookie migration: AuthContext reads this to decide
  // whether a cookie session is worth recovering.
  readCsrfCookie: () => '',
  getBackendUrl: () => 'https://api.meetifyy.app',
  apiClient: { post: (...args) => postMock(...args), get: async () => ({}) },
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

/** A failure that never reached the server: no status attached. */
const netErr = (message, name = 'TypeError') => Object.assign(new Error(message), { name });
/** A failure the server answered with. */
const httpErr = (message, status) => Object.assign(new Error(message), { status });

describe('the Next button on the password step', () => {
  beforeEach(() => {
    postMock.mockReset();
    signUpMock.mockReset();
    vi.stubGlobal('navigator', { onLine: true, userAgent: 'test' });
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('goes to our API, and never to Supabase directly', async () => {
    postMock.mockResolvedValue({ pending: true });
    const t = runSignup();
    await act(async () => { await t.run(); });

    expect(postMock).toHaveBeenCalledTimes(1);
    const [path, body] = postMock.mock.calls[0];
    expect(path).toBe('/api/auth/signup');
    expect(body.email).toBe('student@college.edu');
    expect(body.password).toBe('a-good-password');
    // Calling Supabase from here is what made the endpoint unmeterable.
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it('normalises the address, so the per-address budget cannot be sidestepped by casing', async () => {
    postMock.mockResolvedValue({ pending: true });
    const out = {};
    function Probe() {
      const { initiateSignup } = useAuth();
      out.run = () => initiateSignup({ ...VALID, email: '  Student@College.EDU  ' });
      return null;
    }
    render(<AuthProvider><Probe /></AuthProvider>);
    await act(async () => { await out.run(); });
    expect(postMock.mock.calls[0][1].email).toBe('student@college.edu');
  });

  it('sends no academic detail, which Prisma owns', async () => {
    postMock.mockResolvedValue({ pending: true });
    const t = runSignup();
    await act(async () => { await t.run(); });
    const body = postMock.mock.calls[0][1];
    expect(body.course).toBeUndefined();
    expect(body.branch).toBeUndefined();
    expect(body.passingYear).toBeUndefined();
  });

  it('explains a blocked request instead of surfacing "Failed to fetch"', async () => {
    postMock.mockRejectedValue(netErr('Failed to fetch'));
    const t = runSignup();
    let thrown;
    await act(async () => { thrown = await t.run().catch((e) => e); });

    expect(thrown.message).not.toContain('Failed to fetch');
    // Names the host it could not reach, so a support ticket points at the
    // right system — now our API, since that is where the request goes.
    expect(thrown.message).toContain('api.meetifyy.app');
    // And tells the user their account was not created.
    expect(thrown.message).toContain('Nothing was submitted');
  });

  it('says so plainly when the browser is offline', async () => {
    vi.stubGlobal('navigator', { onLine: false, userAgent: 'test' });
    postMock.mockRejectedValue(netErr('Failed to fetch'));
    const t = runSignup();
    let thrown;
    await act(async () => { thrown = await t.run().catch((e) => e); });
    expect(thrown.message).toContain('offline');
  });

  it('passes a real server error through untouched', async () => {
    // A response-bearing error reached the server; its message is the useful
    // one and must not be replaced with connectivity advice.
    postMock.mockRejectedValue(httpErr('Password is too weak', 400));
    const t = runSignup();
    let thrown;
    await act(async () => { thrown = await t.run().catch((e) => e); });
    expect(thrown.message).toBe('Password is too weak');
  });

  it('passes the server\'s "already pending" conflict through, not a network message', async () => {
    // Detecting a half-finished signup moved server-side with the call itself.
    const pending = 'A signup is already pending for this email. Check your inbox for the verification code, or wait a moment and try again.';
    postMock.mockRejectedValue(httpErr(pending, 409));
    const t = runSignup();
    let thrown;
    await act(async () => { thrown = await t.run().catch((e) => e); });
    expect(thrown.message).toBe(pending);
  });

  it('surfaces a spent rate-limit budget as the server worded it', async () => {
    postMock.mockRejectedValue(httpErr('Too many signup attempts. Please try again later.', 429));
    const t = runSignup();
    let thrown;
    await act(async () => { thrown = await t.run().catch((e) => e); });
    expect(thrown.message).toMatch(/too many signup attempts/i);
  });

  it('does not retry, so a signup cannot be submitted twice', async () => {
    postMock.mockRejectedValue(netErr('Failed to fetch'));
    const t = runSignup();
    await act(async () => { await t.run().catch(() => {}); });
    expect(postMock).toHaveBeenCalledTimes(1);
  });
});

describe('the signup deadline', () => {
  beforeEach(() => {
    postMock.mockReset();
    vi.stubGlobal('navigator', { onLine: true, userAgent: 'test' });
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('stops waiting on a request that never settles, and says the account was not created', async () => {
    // The confirmation email is sent inside this request, so a stalled mail
    // provider hangs it. Without a deadline the browser waits minutes.
    postMock.mockReturnValue(new Promise(() => {}));
    vi.useFakeTimers();
    const t = runSignup();
    const pending = t.run().catch((e) => e);
    await act(async () => { await vi.advanceTimersByTimeAsync(26_000); });
    const thrown = await pending;
    expect(thrown.message).toMatch(/too long/i);
    expect(thrown.message).toContain('not created');
  });

  it('lets a normal, fast signup through untouched', async () => {
    postMock.mockResolvedValue({ pending: true });
    const t = runSignup();
    let result;
    await act(async () => { result = await t.run(); });
    expect(result).toBe(true);
  });
});
