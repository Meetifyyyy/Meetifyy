import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The app's provider auth client loads on first use. What must hold: the same
 * calls work, `onAuthStateChange` still hands back its subscription at once,
 * and nothing is subscribed after an early unsubscribe.
 */
const real = vi.hoisted(() => ({
  verifyOtp: vi.fn(async (args) => ({ data: { session: { args } }, error: null })),
  signOut: vi.fn(async () => ({ error: null })),
  onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
}));

vi.mock('@config', () => ({ config: { supabase: { url: 'https://abc.supabase.co', anonKey: 'k' } } }));
vi.mock('../../shared/lib/supabase.js', () => ({
  supabase: { auth: real },
  isRecoveryTab: () => false,
  clearRecoveryTab: () => {},
  forgetProviderSession: vi.fn(),
}));

describe('mobile supabase facade', () => {
  let facade;
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    facade = await import('../supabaseFacade');
  });

  it('loads the client on first use and passes the call through', async () => {
    const res = await facade.supabase.auth.verifyOtp({ email: 'a@b.c', token: '123456', type: 'email' });
    expect(real.verifyOtp).toHaveBeenCalledWith({ email: 'a@b.c', token: '123456', type: 'email' });
    expect(res.error).toBeNull();
    // Loaded: the real client is used directly from now on.
    expect(facade.supabase.auth).toBe(real);
  });

  it('returns a subscription synchronously and attaches it once loaded', async () => {
    const cb = vi.fn();
    const { data } = facade.supabase.auth.onAuthStateChange(cb);
    expect(typeof data.subscription.unsubscribe).toBe('function');
    await facade.loadSupabase();
    await Promise.resolve();
    expect(real.onAuthStateChange).toHaveBeenCalledWith(cb);
  });

  it('never subscribes after an early unsubscribe', async () => {
    const { data } = facade.supabase.auth.onAuthStateChange(vi.fn());
    data.subscription.unsubscribe();
    await facade.loadSupabase();
    await Promise.resolve();
    expect(real.onAuthStateChange).not.toHaveBeenCalled();
  });

  it('has nothing to forget before the client ever loaded', () => {
    expect(() => facade.forgetProviderSession()).not.toThrow();
    expect(facade.isRecoveryTab()).toBe(false);
  });
});
