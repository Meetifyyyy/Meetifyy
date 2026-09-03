/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, act, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

/**
 * The password the user sets must be stored byte for byte.
 *
 * This screen used to submit `password.trim()` while the login form sends what
 * was typed untouched, so any password with leading or trailing whitespace was
 * saved as something the user could never sign in with. A password manager, a
 * paste, or a mobile keyboard adding a space after autocorrect all produce one.
 */

const updates = [];
let authCallback = null;

vi.mock('@shared/context/AuthContext', () => ({
  supabase: {
    auth: {
      updateUser: async (payload) => { updates.push(payload); return { data: { user: { email: 'a@b.edu' } }, error: null }; },
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: (cb) => { authCallback = cb; return { data: { subscription: { unsubscribe() {} } } }; },
      signOut: async () => ({}),
    },
  },
  isSupabaseConfigured: true,
}));
vi.mock('@shared/api/apiClient', () => ({ getBackendUrl: () => 'http://api.test' }));

const { default: ResetPasswordPage } = await import('@features/auth/pages/ResetPasswordPage');

/** Bring the page to its "valid token, show the form" state. */
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

describe('Reset password stores exactly what was entered', () => {
  beforeEach(() => { updates.length = 0; authCallback = null; window.sessionStorage.clear(); });
  afterEach(() => cleanup());

  it('shows the form once the recovery token validates', async () => {
    const { container } = await renderAtForm();
    expect(container.querySelectorAll('input').length).toBeGreaterThanOrEqual(2);
  });

  it('keeps a trailing space instead of silently dropping it', async () => {
    const { container } = await renderAtForm();
    const secret = 'correct horse battery ';
    fill(container, secret, secret);
    await submitForm(container);
    expect(updates).toHaveLength(1);
    expect(updates[0].password).toBe(secret);
  });

  it('keeps a leading space', async () => {
    const { container } = await renderAtForm();
    const secret = ' leadingSpace123';
    fill(container, secret, secret);
    await submitForm(container);
    expect(updates[0].password).toBe(secret);
  });

  it('keeps special characters untouched', async () => {
    const { container } = await renderAtForm();
    const secret = 'aB3!£$%^&*()_+{}|:"<>?~`-=[];\',./';
    fill(container, secret, secret);
    await submitForm(container);
    expect(updates[0].password).toBe(secret);
  });

  it('stores a long generated password in full', async () => {
    const { container } = await renderAtForm();
    const secret = 'Xk9#mQ2$vL8@pR4!'.repeat(6);
    fill(container, secret, secret);
    await submitForm(container);
    expect(updates[0].password).toBe(secret);
    expect(updates[0].password).toHaveLength(96);
  });

  it('treats a whitespace-only difference as a mismatch, and refuses', async () => {
    const { container } = await renderAtForm();
    // Trimming used to make these compare equal, so the user "confirmed" a
    // password they had not typed.
    fill(container, 'secret123', 'secret123 ');
    await submitForm(container);
    expect(updates).toHaveLength(0);
  });

  it('refuses a password under the minimum length', async () => {
    const { container } = await renderAtForm();
    fill(container, 'short', 'short');
    await submitForm(container);
    expect(updates).toHaveLength(0);
  });

  it('submits once even when the form is fired twice in a row', async () => {
    const { container } = await renderAtForm();
    fill(container, 'a-good-password', 'a-good-password');
    const form = container.querySelector('form');
    await act(async () => { form.requestSubmit(); form.requestSubmit(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 40)); });
    expect(updates).toHaveLength(1);
  });
});

describe('an over-long password is refused, never silently shortened', () => {
  // Scoped per describe: `updates` is module-level, so without this the counts
  // carry over from the block above.
  beforeEach(() => { updates.length = 0; authCallback = null; window.sessionStorage.clear(); });
  afterEach(() => cleanup());

  it('keeps all 150 characters in the field instead of cutting to the limit', async () => {
    const { container } = await renderAtForm();
    const long = 'x'.repeat(150);
    fill(container, long, long);
    const input = container.querySelectorAll('input[type="password"], input[type="text"]')[0];
    // The old `maxLength` attribute truncated a paste at 128 with no warning,
    // which meant the stored password was not the one the user pasted.
    expect(input.getAttribute('maxlength')).toBeNull();
    expect(input.value).toHaveLength(150);
  });

  it('refuses to submit it, and says why', async () => {
    const { container, q } = await renderAtForm();
    const long = 'x'.repeat(150);
    fill(container, long, long);
    await submitForm(container);
    expect(updates).toHaveLength(0);
    expect(q.getByText("Password can't exceed 100 characters.")).toBeTruthy();
  });

  it('accepts a password exactly on the limit', async () => {
    const { container } = await renderAtForm();
    const atLimit = 'y'.repeat(100);
    fill(container, atLimit, atLimit);
    await submitForm(container);
    expect(updates).toHaveLength(1);
    expect(updates[0].password).toHaveLength(100);
  });
});
