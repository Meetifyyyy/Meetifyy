/**
 * The recovery guard, mostly.
 *
 * A password-recovery session is an ordinary session JWT, so the backend cannot
 * tell it from a login — the client is the only thing that can. While a tab sits
 * on /reset-password, a failure here means the recovery credential becomes the
 * Authorization header on every API call that tab makes.
 *
 * It used to be enforced at three separate call sites, each of which had to
 * remember. These tests pin it in the one place it now lives.
 */
import { describe, it, expect, vi } from 'vitest';
import { createWebSessionSource } from '../sessionSource';

function fakeSupabase(initialSession = null) {
  let handler = null;
  return {
    client: {
      auth: {
        getSession: vi.fn(() => Promise.resolve({ data: { session: initialSession } })),
        onAuthStateChange: vi.fn((cb) => {
          handler = cb;
          return { data: { subscription: { unsubscribe() {} } } };
        }),
      },
    },
    fire: (event, session) => handler?.(event, session),
    hasHandler: () => handler !== null,
  };
}

const SESSION = { access_token: 'real-token' };
const RECOVERY = { access_token: 'recovery-token' };

describe('createWebSessionSource', () => {
  it('seeds the token from the stored session', async () => {
    const sb = fakeSupabase(SESSION);
    const s = createWebSessionSource({
      supabase: sb.client,
      isRecoveryTab: () => false,
      clearRecoveryTab: () => {},
    });
    await s.whenReady();
    expect(s.getToken()).toBe('real-token');
    expect(s.hasSession()).toBe(true);
  });

  it('NEVER returns a token while the tab is a recovery tab', async () => {
    const sb = fakeSupabase(RECOVERY);
    const s = createWebSessionSource({
      supabase: sb.client,
      isRecoveryTab: () => true,
      clearRecoveryTab: () => {},
    });
    await s.whenReady();
    expect(s.getToken()).toBe('');
    expect(s.isRecoveryCredential()).toBe(true);
  });

  it('withholds the token even if a session arrives later', async () => {
    const sb = fakeSupabase(null);
    const s = createWebSessionSource({
      supabase: sb.client,
      isRecoveryTab: () => true,
      clearRecoveryTab: () => {},
    });
    await s.whenReady();
    sb.fire('TOKEN_REFRESHED', RECOVERY);
    expect(s.getToken()).toBe('');
  });

  it('checks the recovery latch on every read, not only at cache time', async () => {
    // The latch can flip after a token has been cached — PASSWORD_RECOVERY
    // fires once, but the session it establishes survives INITIAL_SESSION
    // replays and refreshes. A guard applied only on write would leak.
    let recovery = false;
    const sb = fakeSupabase(SESSION);
    const s = createWebSessionSource({
      supabase: sb.client,
      isRecoveryTab: () => recovery,
      clearRecoveryTab: () => {},
    });
    await s.whenReady();
    expect(s.getToken()).toBe('real-token');

    recovery = true;
    expect(s.getToken()).toBe('');
  });

  it('clears the recovery latch on SIGNED_OUT', async () => {
    // The reset page signs the recovery session out when it finishes or when
    // the link turns out to be expired. Staying latched past that would break
    // every request a user makes after signing back in without reloading.
    const clearRecoveryTab = vi.fn();
    const sb = fakeSupabase(null);
    const s = createWebSessionSource({
      supabase: sb.client,
      isRecoveryTab: () => false,
      clearRecoveryTab,
    });
    await s.whenReady();
    sb.fire('SIGNED_OUT', null);
    expect(clearRecoveryTab).toHaveBeenCalledOnce();
  });

  it('tracks sign-in and sign-out through auth events', async () => {
    const sb = fakeSupabase(null);
    const s = createWebSessionSource({
      supabase: sb.client,
      isRecoveryTab: () => false,
      clearRecoveryTab: () => {},
    });
    await s.whenReady();
    expect(s.getToken()).toBe('');

    sb.fire('SIGNED_IN', SESSION);
    expect(s.getToken()).toBe('real-token');

    sb.fire('SIGNED_OUT', null);
    expect(s.getToken()).toBe('');
    expect(s.hasSession()).toBe(false);
  });

  it('forget() drops the cached token', async () => {
    const sb = fakeSupabase(SESSION);
    const s = createWebSessionSource({
      supabase: sb.client,
      isRecoveryTab: () => false,
      clearRecoveryTab: () => {},
    });
    await s.whenReady();
    s.forget();
    expect(s.getToken()).toBe('');
    expect(s.hasSession()).toBe(false);
  });

  it('works with no auth client at all', () => {
    // Supabase is optional configuration; an unconfigured build must not throw
    // at import time.
    const s = createWebSessionSource({
      supabase: null,
      isRecoveryTab: () => false,
      clearRecoveryTab: () => {},
    });
    expect(s.getToken()).toBe('');
    expect(s.whenReady()).toBeNull();
    expect(s.hasSession()).toBe(false);
  });

  it('survives getSession() rejecting', async () => {
    const client = {
      auth: {
        getSession: () => Promise.reject(new Error('network')),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
    };
    const s = createWebSessionSource({
      supabase: client,
      isRecoveryTab: () => false,
      clearRecoveryTab: () => {},
    });
    await expect(s.whenReady()).resolves.toBeNull();
    expect(s.getToken()).toBe('');
  });
});
