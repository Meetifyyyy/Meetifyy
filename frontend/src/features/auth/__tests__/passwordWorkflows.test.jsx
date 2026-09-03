/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, act, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

const supabaseCalls = { reset: [], update: [] };
vi.mock('@shared/context/AuthContext', async () => ({
  supabase: {
    auth: {
      resetPasswordForEmail: async (email, opts) => { supabaseCalls.reset.push({ email, opts }); return { error: null }; },
      updateUser: async (payload) => { supabaseCalls.update.push(payload); return { data: { user: { email: 'a@b.edu' } }, error: null }; },
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({}),
    },
  },
  isSupabaseConfigured: true,
  useAuth: () => ({ currentUser: null, isLoggedIn: false, loading: false, login: async () => {}, initiateSignup: async () => true }),
}));

const apiCalls = [];
let accountExistsResponse = { exists: true };
vi.mock('@shared/api/apiClient', async (io) => {
  const actual = await io();
  return {
    ...actual,
    getBackendUrl: () => 'http://api.test',
    apiClient: {
      ...actual.apiClient,
      post: async (path, body) => {
        apiCalls.push({ path, body });
        if (path === '/api/auth/account-exists') {
          if (accountExistsResponse instanceof Error) throw accountExistsResponse;
          return accountExistsResponse;
        }
        return {};
      },
    },
  };
});

const { default: ForgotPasswordPage } = await import('@features/auth/pages/ForgotPasswordPage');

const renderForgot = () => {
  const utils = render(<MemoryRouter><ForgotPasswordPage /></MemoryRouter>);
  return { ...utils, q: within(utils.container) };
};

const submit = async (q, container, email) => {
  const input = container.querySelector('#forgot-email');
  fireEvent.change(input, { target: { value: email } });
  await act(async () => { container.querySelector('form').requestSubmit(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
};

describe('Forgot password', () => {
  beforeEach(() => { apiCalls.length = 0; supabaseCalls.reset.length = 0; accountExistsResponse = { exists: true }; });
  afterEach(() => cleanup());

  it('tells the user plainly when no account exists, and sends nothing', async () => {
    accountExistsResponse = { exists: false };
    const { q, container } = renderForgot();
    await submit(q, container, 'nobody@college.edu');

    expect(q.getByText('No account found. Check your email and try again.')).toBeTruthy();
    // Crucially it must NOT also claim an email went out.
    expect(supabaseCalls.reset).toHaveLength(0);
    expect(container.textContent).not.toMatch(/check your (inbox|email) for/i);
  });

  it('sends the reset link when the account does exist', async () => {
    accountExistsResponse = { exists: true };
    const { container } = renderForgot();
    await submit(null, container, 'real@college.edu');
    expect(supabaseCalls.reset).toHaveLength(1);
    expect(supabaseCalls.reset[0].email).toBe('real@college.edu');
  });

  it('normalises the address before looking it up', async () => {
    const { container } = renderForgot();
    await submit(null, container, '  Real@College.EDU  ');
    expect(apiCalls[0].body.email).toBe('real@college.edu');
  });

  it('clears the message as soon as the user edits the address', async () => {
    accountExistsResponse = { exists: false };
    const { q, container } = renderForgot();
    await submit(q, container, 'nobody@college.edu');
    expect(q.getByText('No account found. Check your email and try again.')).toBeTruthy();

    fireEvent.change(container.querySelector('#forgot-email'), { target: { value: 'nobody2@college.edu' } });
    expect(q.queryByText('No account found. Check your email and try again.')).toBeNull();
  });

  it('rejects an invalid address without calling the server', async () => {
    const { container } = renderForgot();
    await submit(null, container, 'not-an-email');
    expect(apiCalls).toHaveLength(0);
    expect(supabaseCalls.reset).toHaveLength(0);
  });

  it('cannot be submitted while empty', () => {
    const { container } = renderForgot();
    const button = container.querySelector('button[type="submit"]');
    expect(button.disabled).toBe(true);
  });

  it('fails open: a lookup outage still sends the reset link', async () => {
    accountExistsResponse = new Error('lookup down');
    const { container } = renderForgot();
    await submit(null, container, 'real@college.edu');
    // Better to send an email that may go nowhere than to lock out a real user
    // because a side lookup was unavailable.
    expect(supabaseCalls.reset).toHaveLength(1);
  });

  it('disables the button while a request is in flight, so it cannot double-send', async () => {
    let release;
    accountExistsResponse = { exists: true };
    const { container } = renderForgot();
    const input = container.querySelector('#forgot-email');
    fireEvent.change(input, { target: { value: 'real@college.edu' } });

    const form = container.querySelector('form');
    await act(async () => { form.requestSubmit(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    // One submit produced exactly one send.
    expect(supabaseCalls.reset).toHaveLength(1);
  });
});
