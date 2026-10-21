/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, act, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

/**
 * Where the reset screen says what is wrong with the password.
 *
 * It used to raise a pill-shaped toast at the bottom of the viewport: a
 * different message surface from every other auth screen, one line that was cut
 * off with an ellipsis ("New password should be different from the old
 * passw..."), and far from the field it was about on a large screen. Now a
 * problem with a field is said under that field, briefly, and anything else
 * goes to the shared auth alert.
 */

let updateResult = { error: null };
let authCallback = null;

vi.mock('@shared/context/AuthContext', () => ({
  supabase: {
    auth: {
      updateUser: async () => updateResult,
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: (cb) => { authCallback = cb; return { data: { subscription: { unsubscribe() {} } } }; },
      signOut: async () => ({}),
    },
  },
  isSupabaseConfigured: true,
}));
vi.mock('@shared/api/apiClient', () => ({
  readCsrfCookie: () => '',
  mayHaveCookieSession: () => false,
  rememberCsrfToken: () => {},
  forgetCsrfToken: () => {},
  authApi: {
    currentSession: async () => ({ user: null }),
    adoptSession: async () => ({}),
    logoutSession: async () => ({}),
  },
  getBackendUrl: () => 'http://api.test',
}));

const { default: ResetPasswordPage } = await import('@features/auth/pages/ResetPasswordPage');

async function renderAtForm() {
  const utils = render(<MemoryRouter><ResetPasswordPage /></MemoryRouter>);
  await act(async () => {
    authCallback?.('PASSWORD_RECOVERY', { access_token: 'tok' });
    await new Promise((r) => setTimeout(r, 20));
  });
  return { ...utils, q: within(utils.container) };
}

const fill = (container, pw, confirm) => {
  const inputs = container.querySelectorAll('input[type="password"], input[type="text"]');
  fireEvent.change(inputs[0], { target: { value: pw } });
  fireEvent.change(inputs[1], { target: { value: confirm } });
};

const submitForm = async (container) => {
  await act(async () => { container.querySelector('form').requestSubmit(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
};

/** The message slot of one field, found through the input's aria-describedby. */
const messageOf = (container, inputId) => {
  const input = container.querySelector(`#${inputId}`);
  const slot = container.querySelector(`#${input.getAttribute('aria-describedby')}`);
  return slot?.textContent.trim() ?? '';
};

describe('Reset password warnings', () => {
  beforeEach(() => { updateResult = { error: null }; authCallback = null; window.sessionStorage.clear(); });
  afterEach(() => cleanup());

  it('says "same as the old password" under the New Password field, in a few words', async () => {
    updateResult = { error: { code: 'same_password', message: 'New password should be different from the old password.' } };
    const { container } = await renderAtForm();
    fill(container, 'Brand-new-pass1', 'Brand-new-pass1');
    await submitForm(container);

    const text = messageOf(container, 'reset-new-password');
    expect(text).toMatch(/different/i);
    expect(text.length).toBeLessThan(50);
    // The page no longer owns a bottom toast.
    expect(container.ownerDocument.getElementById('toast')).toBeNull();
  });

  it('says a mismatch under the Confirm field', async () => {
    const { container } = await renderAtForm();
    fill(container, 'Brand-new-pass1', 'Brand-new-pass2');
    await submitForm(container);
    expect(messageOf(container, 'reset-confirm-password')).toBe("Passwords don't match");
    expect(messageOf(container, 'reset-new-password')).toBe('');
  });

  it('clears the warning as soon as the field is edited', async () => {
    updateResult = { error: { code: 'same_password', message: 'New password should be different from the old password.' } };
    const { container } = await renderAtForm();
    fill(container, 'Brand-new-pass1', 'Brand-new-pass1');
    await submitForm(container);
    expect(messageOf(container, 'reset-new-password')).not.toBe('');

    fireEvent.change(container.querySelector('#reset-new-password'), { target: { value: 'Another-pass2' } });
    expect(messageOf(container, 'reset-new-password')).toBe('');
  });

  it('puts any other failure in the shared auth alert, not under a field', async () => {
    updateResult = { error: { message: 'Auth session missing!' } };
    const { container } = await renderAtForm();
    fill(container, 'Brand-new-pass1', 'Brand-new-pass1');
    await submitForm(container);

    expect(within(document.body).getByRole('alert').textContent).toContain('Auth session missing!');
    expect(messageOf(container, 'reset-new-password')).toBe('');
  });
});
