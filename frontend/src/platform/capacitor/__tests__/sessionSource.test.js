import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createCapacitorSessionSource } from '../sessionSource';

/**
 * An in-memory stand-in for Keychain/Keystore, so these tests describe what is
 * KEPT and what is DELIBERATELY NOT KEPT. That distinction is the whole design:
 * the thirty-day refresh token is worth protecting, the hour-long access token
 * is not worth a second copy on disk.
 */
function fakeSecureStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    get: vi.fn(async (k) => (store.has(k) ? store.get(k) : null)),
    set: vi.fn(async (k, v) => void store.set(k, v)),
    remove: vi.fn(async (k) => void store.delete(k)),
    clear: vi.fn(async () => void store.clear()),
  };
}

const REFRESH_KEY = 'mf.session.refresh';
const SESSION_ID_KEY = 'mf.session.id';

describe('createCapacitorSessionSource', () => {
  let secureStorage;

  beforeEach(() => {
    secureStorage = fakeSecureStorage();
  });

  describe('what reaches disk', () => {
    it('persists the refresh token and session id', async () => {
      const source = createCapacitorSessionSource({ secureStorage });

      await source.adopt({
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        sessionId: 'session-1',
      });

      expect(secureStorage.store.get(REFRESH_KEY)).toBe('refresh-1');
      expect(secureStorage.store.get(SESSION_ID_KEY)).toBe('session-1');
    });

    /**
     * The access token must NOT be written. It expires in an hour and is
     * reminted from the refresh token on demand, so storing it would put a
     * second copy of a live credential on disk for no benefit at all.
     */
    it('never writes the access token to storage', async () => {
      const source = createCapacitorSessionSource({ secureStorage });

      await source.adopt({
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        sessionId: 'session-1',
      });

      expect([...secureStorage.store.values()]).not.toContain('access-1');
      expect(source.getToken()).toBe('access-1');
    });
  });

  describe('restoring across launches', () => {
    it('loads a stored session into memory', async () => {
      secureStorage = fakeSecureStorage({
        [REFRESH_KEY]: 'refresh-1',
        [SESSION_ID_KEY]: 'session-1',
      });
      const source = createCapacitorSessionSource({ secureStorage });

      await expect(source.whenReady()).resolves.toBe(true);
      expect(source.getRefreshToken()).toBe('refresh-1');
      expect(source.getSessionId()).toBe('session-1');
    });

    /**
     * There is no stored access token by design, so a cold start begins
     * unauthenticated and the transport's existing 401 refresh-and-retry mints
     * one. If this ever returned a token, something started writing one down.
     */
    it('starts with no access token, so the refresh path has to run', async () => {
      secureStorage = fakeSecureStorage({
        [REFRESH_KEY]: 'refresh-1',
        [SESSION_ID_KEY]: 'session-1',
      });
      const source = createCapacitorSessionSource({ secureStorage });

      await source.whenReady();
      expect(source.getToken()).toBe('');
    });

    it('reads storage only once however many callers ask', async () => {
      const source = createCapacitorSessionSource({ secureStorage });

      await Promise.all([source.whenReady(), source.whenReady(), source.whenReady()]);

      expect(secureStorage.get).toHaveBeenCalledTimes(2); // one per key, once
    });

    it('is signed out when only half a session survives', async () => {
      secureStorage = fakeSecureStorage({ [REFRESH_KEY]: 'refresh-1' });
      const source = createCapacitorSessionSource({ secureStorage });

      await expect(source.whenReady()).resolves.toBe(false);
      expect(source.getRefreshToken()).toBe('');
    });

    /**
     * A Keychain entry whose key is gone — a device restore onto new hardware —
     * makes reads throw. That is an ordinary signed-out state, and it must not
     * stop the app reaching its own login screen.
     */
    it('is signed out, not broken, when storage throws', async () => {
      secureStorage.get = vi.fn(async () => {
        throw new Error('keystore key not found');
      });
      const source = createCapacitorSessionSource({ secureStorage });

      await expect(source.whenReady()).resolves.toBe(false);
    });
  });

  describe('rotation', () => {
    /**
     * A refresh returns a rotated refresh token and the server retires the one
     * just presented. Failing to store the new one leaves nothing usable: the
     * next refresh presents a retired token, which reads as a replay and
     * revokes the whole family.
     */
    it('replaces the stored refresh token on rotation', async () => {
      const source = createCapacitorSessionSource({ secureStorage });
      await source.adopt({ refreshToken: 'refresh-1', sessionId: 'session-1' });

      await source.adopt({ accessToken: 'access-2', refreshToken: 'refresh-2' });

      expect(secureStorage.store.get(REFRESH_KEY)).toBe('refresh-2');
      expect(source.getRefreshToken()).toBe('refresh-2');
    });

    /** A partial payload must not erase the fields it simply does not mention. */
    it('keeps the session id when a response omits it', async () => {
      const source = createCapacitorSessionSource({ secureStorage });
      await source.adopt({ refreshToken: 'refresh-1', sessionId: 'session-1' });

      await source.adopt({ accessToken: 'access-2' });

      expect(source.getSessionId()).toBe('session-1');
      expect(source.getRefreshToken()).toBe('refresh-1');
    });

    it('ignores an empty payload rather than clearing the session', async () => {
      const source = createCapacitorSessionSource({ secureStorage });
      await source.adopt({ refreshToken: 'refresh-1', sessionId: 'session-1' });

      await source.adopt(null);

      expect(source.getRefreshToken()).toBe('refresh-1');
    });
  });

  describe('signing out', () => {
    it('clears memory and storage together', async () => {
      const source = createCapacitorSessionSource({ secureStorage });
      await source.adopt({
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        sessionId: 'session-1',
      });

      await source.forget();

      expect(source.getToken()).toBe('');
      expect(source.getRefreshToken()).toBe('');
      expect(source.getSessionId()).toBe('');
      expect(secureStorage.store.size).toBe(0);
    });
  });

  describe('contract', () => {
    /**
     * Password recovery is a web concept — a tab holding a provider session
     * that must never be sent to the API. The app has no such tab.
     */
    it('never reports a recovery credential', () => {
      const source = createCapacitorSessionSource({ secureStorage });
      expect(source.isRecoveryCredential()).toBe(false);
    });
  });
});
