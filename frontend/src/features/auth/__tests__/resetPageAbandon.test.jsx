/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// The auth shell measures itself on mount; jsdom has neither observer.
globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

/**
 * Leaving the reset page must abandon the recovery credential.
 *
 * While the page is open, two things deliberately treat this tab as special:
 * AuthContext keeps the recovery session out of global auth state, and
 * apiClient refuses to attach its token to any API call. Both are right while
 * the user is here, and neither should outlive the visit.
 *
 * Every path that FINISHES the flow already signs out. Abandonment did not, so
 * the marker stayed set for the rest of the tab's life — and a user who then
 * signed in without reloading was accepted by the app while every request went
 * out with no token.
 */
let recoveryTab = true;
const signOut = vi.fn(async () => ({}));
const cleared = { count: 0 };

vi.mock('@shared/context/AuthContext', () => ({
  supabase: {
    auth: {
      signOut: (...a) => signOut(...a),
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      updateUser: async () => ({ data: { user: null }, error: null }),
    },
  },
  isSupabaseConfigured: true,
}));
vi.mock('@shared/lib/supabase', () => ({
  isRecoveryTab: () => recoveryTab,
  clearRecoveryTab: () => { cleared.count += 1; recoveryTab = false; },
}));
vi.mock('@shared/api/apiClient', () => ({
  // Added with the cookie migration: AuthContext reads this to decide
  // whether a cookie session is worth recovering.
  readCsrfCookie: () => '', getBackendUrl: () => 'http://api.test' }));

const { default: ResetPasswordPage } = await import('@features/auth/pages/ResetPasswordPage');

describe('abandoning the reset page', () => {
  beforeEach(() => {
    signOut.mockClear();
    cleared.count = 0;
    recoveryTab = true;
    try { sessionStorage.clear(); } catch { /* blocked storage */ }
  });
  afterEach(() => cleanup());

  it('clears the recovery marker and signs the credential out on unmount', async () => {
    const { unmount } = render(<MemoryRouter><ResetPasswordPage /></MemoryRouter>);
    await act(async () => { unmount(); });

    expect(cleared.count).toBe(1);
    expect(signOut).toHaveBeenCalled();
  });

  it('does nothing on unmount when this was never a recovery tab', async () => {
    // A signed-in user who navigates to /reset-password by hand must not be
    // signed out just for visiting.
    recoveryTab = false;
    const { unmount } = render(<MemoryRouter><ResetPasswordPage /></MemoryRouter>);
    await act(async () => { unmount(); });

    expect(cleared.count).toBe(0);
    expect(signOut).not.toHaveBeenCalled();
  });
});
