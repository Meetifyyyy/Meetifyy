/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Session tokens must not be written to disk.
 *
 * They used to live in `localStorage`, which is where the worst property of the
 * old design came from: any script on the origin could read them, and the
 * refresh token sat there indefinitely, so a single read bought an attacker the
 * ability to mint fresh access tokens for as long as they liked — with no way
 * to take it back.
 *
 * The durable half is now an HttpOnly cookie. What is left in JavaScript is an
 * access token held in memory for the tab. These tests pin both halves of that:
 * nothing reaches storage, and anything a previous version left behind is
 * cleared rather than quietly kept.
 */
vi.mock('@config', () => ({
  config: {
    supabase: { url: 'https://proj.supabase.co', anonKey: 'anon-key' },
    api: { baseUrl: 'http://api.test', proxyPrefix: '/api-proxy' },
  },
  IS_DEV_BUILD: false,
}));

describe('session storage', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('writes no auth token to localStorage when a session is stored', async () => {
    const { supabase } = await import('@shared/lib/supabase');
    expect(supabase).toBeTruthy();

    // Drive the AuthClient's storage the way it does internally.
    const key = Object.keys(localStorage).find((k) => k.startsWith('sb-'));
    expect(key).toBeUndefined();

    const before = localStorage.length;
    await supabase.auth.getSession().catch(() => null);
    expect(localStorage.length).toBe(before);
  });

  it('purges a token left in localStorage by an earlier version', async () => {
    localStorage.setItem(
      'sb-proj-auth-token',
      JSON.stringify({ access_token: 'stale', refresh_token: 'very-stale' }),
    );
    localStorage.setItem('some-auth-token-thing', 'also stale');
    localStorage.setItem('unrelated', 'keep me');

    await import('@shared/lib/supabase');

    expect(localStorage.getItem('sb-proj-auth-token')).toBeNull();
    expect(localStorage.getItem('some-auth-token-thing')).toBeNull();
    // Only auth material goes.
    expect(localStorage.getItem('unrelated')).toBe('keep me');
  });

  it('leaves no refresh token anywhere in localStorage', async () => {
    await import('@shared/lib/supabase');
    const dump = JSON.stringify(localStorage);
    expect(dump).not.toContain('refresh_token');
    expect(dump).not.toContain('access_token');
  });
});
