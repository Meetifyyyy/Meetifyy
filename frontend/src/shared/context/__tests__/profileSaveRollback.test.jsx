/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';

const updateProfileMock = vi.fn();

vi.mock('@shared/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({}),
      updateUser: async () => ({}),
    },
  },
  isSupabaseConfigured: false,
}));
vi.mock('@config', () => ({
  config: { supabase: { url: 'https://example.supabase.co', anonKey: 'k' } },
  IS_DEV_BUILD: false,
}));
vi.mock('@shared/api/apiClient', () => ({
  // Added with the cookie migration: AuthContext reads this to decide
  // whether a cookie session is worth recovering.
  readCsrfCookie: () => '',
  getBackendUrl: () => 'https://api.example',
  apiClient: { post: async () => ({}), get: async () => ({}) },
  usersApi: { updateProfile: (...a) => updateProfileMock(...a) },
}));
vi.mock('@tanstack/react-query', async (io) => {
  const actual = await io();
  return {
    ...actual,
    useQueryClient: () => ({
      clear: () => {}, removeQueries: () => {}, setQueryData: () => {},
      invalidateQueries: () => {}, refetchQueries: () => {}, getQueriesData: () => [],
      // propagateUserMedia rewrites every cached payload through this one.
      setQueriesData: () => {}, removeQueries_: () => {},
    }),
  };
});

const { AuthProvider, useAuth } = await import('@shared/context/AuthContext');

const EXISTING = {
  id: 'u1',
  username: 'sarthak',
  displayName: 'Sarthak Saini',
  avatar: 'https://cdn.example/old.svg',
};

/**
 * A failed profile save must not leave the browser showing a change the server
 * refused.
 *
 * The bug: `updateProfile` wrote the new avatar into `currentUser` and
 * `localStorage` before the request, and on failure only logged it. The local
 * copy kept the new image — across reloads, because it had been persisted —
 * while the server still held the old one. The owner saw their new avatar
 * everywhere the cached profile was read and the old one everywhere the server
 * was read, including on their own posts. It also resolved instead of
 * rejecting, so the caller's error handling could never run and the avatar
 * picker reported "Avatar updated" for a save that had not happened.
 */
describe('updateProfile when the save fails', () => {
  let auth;

  const Probe = () => {
    auth = useAuth();
    return null;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('currentUser', JSON.stringify(EXISTING));
    render(<AuthProvider><Probe /></AuthProvider>);
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('rejects, so the caller can tell the user it failed', async () => {
    updateProfileMock.mockRejectedValue(new Error('network down'));

    await act(async () => {
      await expect(
        auth.updateProfile({ avatar: 'https://cdn.example/new.svg' }),
      ).rejects.toThrow('network down');
    });
  });

  it('leaves the stored profile on the value the server still holds', async () => {
    updateProfileMock.mockRejectedValue(new Error('network down'));

    await act(async () => {
      await auth.updateProfile({ avatar: 'https://cdn.example/new.svg' }).catch(() => {});
    });

    const stored = JSON.parse(localStorage.getItem('currentUser'));
    expect(stored.avatar).toBe(EXISTING.avatar);
    expect(auth.currentUser.avatar).toBe(EXISTING.avatar);
  });

  it('keeps the change when the save succeeds', async () => {
    updateProfileMock.mockResolvedValue({
      user: { ...EXISTING, avatar: 'https://cdn.example/new.svg' },
    });

    await act(async () => {
      await auth.updateProfile({ avatar: 'https://cdn.example/new.svg' });
    });

    const stored = JSON.parse(localStorage.getItem('currentUser'));
    expect(stored.avatar).toBe('https://cdn.example/new.svg');
  });

  /**
   * The server is allowed to store something other than what was sent. When it
   * does, its answer wins over the optimistic guess.
   */
  it('takes the value the server returned over the optimistic one', async () => {
    updateProfileMock.mockResolvedValue({
      user: { ...EXISTING, avatar: 'https://cdn.example/normalised.svg' },
    });

    await act(async () => {
      await auth.updateProfile({ avatar: 'https://cdn.example/new.svg' });
    });

    expect(auth.currentUser.avatar).toBe('https://cdn.example/normalised.svg');
  });
});
