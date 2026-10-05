/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createCapacitorSessionSource } from '../sessionSource';

/**
 * An in-memory stand-in for Keychain/Keystore, so these tests describe what is
 * kept, and when a stored access token may be used at launch.
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
const ACCESS_KEY = 'mf.session.access';

const NOW = 1_800_000_000_000;
/** A JWT-shaped token whose `exp` claim is `expMs`. */
const jwt = (expMs) =>
  `h.${btoa(JSON.stringify({ exp: Math.floor(expMs / 1000) })).replace(/=+$/, '')}.s`;

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
     * The access token is kept beside the refresh token, with its expiry, so a
     * launch within its lifetime needs no rotation. See sessionSource.js.
     */
    it('persists the access token with the expiry from its own claim', async () => {
      const source = createCapacitorSessionSource({ secureStorage, now: () => NOW });
      const token = jwt(NOW + 3_600_000);

      await source.adopt({ accessToken: token, refreshToken: 'refresh-1', sessionId: 'session-1', expiresIn: 60 });

      expect(JSON.parse(secureStorage.store.get(ACCESS_KEY))).toEqual({
        token,
        exp: Math.floor((NOW + 3_600_000) / 1000) * 1000,
      });
      expect(source.getToken()).toBe(token);
    });

    it('does not write an access token whose expiry cannot be known', async () => {
      const source = createCapacitorSessionSource({ secureStorage });

      await source.adopt({ accessToken: 'opaque', refreshToken: 'refresh-1', sessionId: 'session-1' });

      expect(secureStorage.store.has(ACCESS_KEY)).toBe(false);
      expect(source.getToken()).toBe('opaque');
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

    it('uses a stored access token that is still good, so the launch skips the rotation', async () => {
      const token = jwt(NOW + 30 * 60_000);
      secureStorage = fakeSecureStorage({
        [REFRESH_KEY]: 'refresh-1',
        [SESSION_ID_KEY]: 'session-1',
        [ACCESS_KEY]: JSON.stringify({ token, exp: NOW + 30 * 60_000 }),
      });
      const source = createCapacitorSessionSource({ secureStorage, now: () => NOW });

      await source.whenReady();
      expect(source.getToken()).toBe(token);
    });

    it('ignores one about to expire, so the transport renews first', async () => {
      secureStorage = fakeSecureStorage({
        [REFRESH_KEY]: 'refresh-1',
        [SESSION_ID_KEY]: 'session-1',
        [ACCESS_KEY]: JSON.stringify({ token: 'nearly-gone', exp: NOW + 60_000 }),
      });
      const source = createCapacitorSessionSource({ secureStorage, now: () => NOW });

      await source.whenReady();
      expect(source.getToken()).toBe('');
    });

    it('never uses an access token without the session it belongs to', async () => {
      secureStorage = fakeSecureStorage({
        [ACCESS_KEY]: JSON.stringify({ token: 'orphan', exp: NOW + 3_600_000 }),
      });
      const source = createCapacitorSessionSource({ secureStorage, now: () => NOW });

      await expect(source.whenReady()).resolves.toBe(false);
      expect(source.getToken()).toBe('');
    });

    it('reads storage only once however many callers ask', async () => {
      const source = createCapacitorSessionSource({ secureStorage });

      await Promise.all([source.whenReady(), source.whenReady(), source.whenReady()]);

      expect(secureStorage.get).toHaveBeenCalledTimes(3); // one per key, once
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
        accessToken: jwt(Date.now() + 3_600_000),
        refreshToken: 'refresh-1',
        sessionId: 'session-1',
      });
      expect(secureStorage.store.has(ACCESS_KEY)).toBe(true);

      await source.forget();

      expect(source.getToken()).toBe('');
      expect(source.getRefreshToken()).toBe('');
      expect(source.getSessionId()).toBe('');
      expect(secureStorage.store.size).toBe(0);
    });
  });

  describe('foreground gate', () => {
    it('waits while hidden and resolves when the app is shown', async () => {
      const source = createCapacitorSessionSource({ secureStorage });
      let state = 'hidden';
      const spy = vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => state);
      let done = false;
      const waiting = source.whenForeground().then(() => { done = true; });
      await Promise.resolve();
      expect(done).toBe(false);

      state = 'visible';
      document.dispatchEvent(new Event('visibilitychange'));
      await waiting;
      expect(done).toBe(true);
      spy.mockRestore();
    });

    it('resolves at once when already visible', async () => {
      const source = createCapacitorSessionSource({ secureStorage });
      await expect(source.whenForeground()).resolves.toBeUndefined();
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
