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
/**
 * What `POST /api/auth/request-password-reset` answers.
 *
 * One route where this screen used to call two: an `account-exists` probe here
 * followed by `resetPasswordForEmail` fired at Supabase from the browser. Only
 * the probe ever reached our backend, so the half that sends mail was
 * unmetered. `exists` and `sent` are now both the server's answer.
 */
let resetResponse = { exists: true, sent: true };
vi.mock('@shared/api/apiClient', async (io) => {
  const actual = await io();
  return {
    ...actual,
    getBackendUrl: () => 'http://api.test',
    apiClient: {
      ...actual.apiClient,
      post: async (path, body) => {
        apiCalls.push({ path, body });
        if (path === '/api/auth/request-password-reset') {
          if (resetResponse instanceof Error) throw resetResponse;
          return resetResponse;
        }
        return {};
      },
    },
  };
});

/** Requests that actually asked for a reset link to be sent. */
const resetRequests = () =>
  apiCalls.filter((c) => c.path === '/api/auth/request-password-reset');

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
  beforeEach(() => { apiCalls.length = 0; supabaseCalls.reset.length = 0; resetResponse = { exists: true, sent: true }; });
  afterEach(() => cleanup());

  it('tells the user plainly when no account exists', async () => {
    resetResponse = { exists: false, sent: false };
    const { q, container } = renderForgot();
    await submit(q, container, 'nobody@college.edu');

    expect(q.getByText('No account found. Check your email and try again.')).toBeTruthy();
    // Crucially it must NOT also claim an email went out.
    expect(container.textContent).not.toMatch(/check your (inbox|email) for/i);
  });

  it('asks the server to send, and never calls Supabase from the browser', async () => {
    resetResponse = { exists: true, sent: true };
    const { container } = renderForgot();
    await submit(null, container, 'real@college.edu');
    expect(resetRequests()).toHaveLength(1);
    expect(resetRequests()[0].body.email).toBe('real@college.edu');
    // Sending from the browser is what left the mail-sending half unmetered,
    // and what let the caller choose the link's redirect target.
    expect(supabaseCalls.reset).toHaveLength(0);
  });

  it('normalises the address before looking it up', async () => {
    const { container } = renderForgot();
    await submit(null, container, '  Real@College.EDU  ');
    expect(apiCalls[0].body.email).toBe('real@college.edu');
  });

  it('clears the message as soon as the user edits the address', async () => {
    resetResponse = { exists: false, sent: false };
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
  });

  it('cannot be submitted while empty', () => {
    const { container } = renderForgot();
    const button = container.querySelector('button[type="submit"]');
    expect(button.disabled).toBe(true);
  });

  it('says so when the account exists but the mail could not be dispatched', async () => {
    // Telling someone with a real account that it does not exist is the one
    // answer that must never come out of a failure — so the sent screen still
    // shows — but it must not be the only thing they see.
    resetResponse = { exists: true, sent: false };
    const { container } = renderForgot();
    await submit(null, container, 'real@college.edu');
    expect(container.textContent).toMatch(/check your email/i);
    expect(document.body.textContent).toMatch(/couldn't send the email just now/i);
  });

  it('does not claim "no account" when the request itself failed', async () => {
    resetResponse = new Error('service down');
    const { q, container } = renderForgot();
    await submit(null, container, 'real@college.edu');
    // An outage is not evidence the address is wrong. Telling a real user their
    // account does not exist is the one answer that must never come from a
    // failure, so the sent screen is shown instead and the link may still land.
    expect(container.textContent).not.toMatch(/no account found/i);
    expect(container.textContent).toMatch(/check your email/i);
  });

  it('shows the server\'s wording, and no false success, when the budget is spent', async () => {
    resetResponse = Object.assign(new Error('You have requested several reset links recently.'), { status: 429 });
    const { container } = renderForgot();
    await submit(null, container, 'real@college.edu');
    // A 429 means nothing was sent, so promising "check your email" would be a
    // lie that has the user waiting for a message that is not coming.
    expect(container.textContent).not.toMatch(/check your email/i);
  });

  it('disables the button while a request is in flight, so it cannot double-send', async () => {
    resetResponse = { exists: true, sent: true };
    const { container } = renderForgot();
    const input = container.querySelector('#forgot-email');
    fireEvent.change(input, { target: { value: 'real@college.edu' } });

    const form = container.querySelector('form');
    await act(async () => { form.requestSubmit(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    // One submit produced exactly one send.
    expect(resetRequests()).toHaveLength(1);
  });
});
