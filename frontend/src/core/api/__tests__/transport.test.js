/**
 * What `createTransport` guarantees.
 *
 * Not the request path in detail — the app's own suites cover the 401 retry,
 * the conditional requests and the failover, and they exercise the real thing
 * rather than a stub of it. What is asserted here is the property that makes
 * two clients possible at all, and which nothing else checks: that a transport
 * owns its state, takes its platform as an argument, and reaches for no global.
 *
 * Running in the default `node` environment is half the test. There is no
 * `window` here, no `localStorage`, no `document`. A transport that quietly
 * depended on one would fail to construct.
 */
import { describe, it, expect, vi } from 'vitest';
import { createTransport } from '../transport';

const stubStore = () => {
  const m = new Map();
  return {
    get: (k) => (m.has(k) ? m.get(k) : null),
    set: (k, v) => m.set(k, v),
    remove: (k) => m.delete(k),
    clearPrefixed: (p) => { for (const k of [...m.keys()]) if (k.startsWith(p)) m.delete(k); },
    _map: m,
  };
};

const build = (over = {}) => {
  const sessionStore = over.sessionStore ?? stubStore();
  const localStore = over.localStore ?? stubStore();
  const deps = {
    apiOrigin: {
      baseUrl: () => 'https://api.example.test',
      socketUrl: () => 'https://api.example.test',
      fallbackBaseUrl: () => 'https://app.example.test/_api',
      privateMediaTarget: () => ({ kind: 'api' }),
      canFailOver: () => true,
      ...over.apiOrigin,
    },
    session: {
      getToken: () => '',
      isRecoveryCredential: () => false,
      whenReady: () => null,
      forget: () => {},
      ...over.session,
    },
    cookies: { readCsrf: () => '', ...over.cookies },
    localStore,
    sessionStore,
    etags: {
      get: () => '', set: () => {}, drop: () => {}, clear: () => {}, ...over.etags,
    },
    hooks: { ...over.hooks },
  };
  return { t: createTransport(deps), deps, sessionStore, localStore };
};

describe('createTransport — shape', () => {
  it('constructs with no browser present', () => {
    // The environment here has no window, document or localStorage. If the
    // transport reached for one, this line would throw.
    expect(() => build()).not.toThrow();
  });

  it('returns the surface the composition root re-exports', () => {
    const { t } = build();
    for (const name of [
      'apiClient', 'request', 'getToken', 'getAccessToken', 'getBackendUrl',
      'isApiFailoverActive', 'readCsrfCookie', 'rememberCsrfToken',
      'forgetCsrfToken', 'mayHaveCookieSession', 'clearLocalAuthState',
    ]) {
      expect(t[name], name).toBeDefined();
    }
    for (const verb of ['get', 'post', 'patch', 'put', 'delete']) {
      expect(t.apiClient[verb], verb).toBeTypeOf('function');
    }
  });

  it('does not touch its dependencies at construction time', () => {
    // A transport that called its session or its stores while being built could
    // not be created before auth is ready — which is exactly when a composition
    // root needs to create it.
    const spies = {
      session: { getToken: vi.fn(() => ''), isRecoveryCredential: vi.fn(() => false) },
      cookies: { readCsrf: vi.fn(() => '') },
    };
    build(spies);
    expect(spies.session.getToken).not.toHaveBeenCalled();
    expect(spies.cookies.readCsrf).not.toHaveBeenCalled();
  });
});

describe('createTransport — two clients are independent', () => {
  it('each uses its own origin', () => {
    const a = build({ apiOrigin: { baseUrl: () => 'https://a.test' } });
    const b = build({ apiOrigin: { baseUrl: () => 'https://b.test' } });
    expect(a.t.getBackendUrl()).toBe('https://a.test');
    expect(b.t.getBackendUrl()).toBe('https://b.test');
  });

  it('each owns its CSRF token', () => {
    const a = build();
    const b = build();
    a.t.rememberCsrfToken('token-a');
    b.t.rememberCsrfToken('token-b');
    a.t.forgetCsrfToken();
    // b is untouched by a's teardown. If this ever fails, the two clients are
    // sharing module state and one signing out affects the other.
    expect(b.t.mayHaveCookieSession()).toBe(false);
    expect(() => b.t.forgetCsrfToken()).not.toThrow();
  });

  it('each reads its own failover flag at construction', () => {
    const armed = stubStore();
    armed.set('meetifyy_api_failover', '1');
    const a = build({ sessionStore: armed });
    const b = build();
    expect(a.t.isApiFailoverActive()).toBe(true);
    expect(b.t.isApiFailoverActive()).toBe(false);
  });

  it('each purges only its own stores', () => {
    const a = build();
    const b = build();
    a.localStore.set('loggedIn', 'true');
    b.localStore.set('loggedIn', 'true');

    a.t.clearLocalAuthState();

    expect(a.localStore.get('loggedIn')).toBeNull();
    expect(b.localStore.get('loggedIn')).toBe('true');
  });
});

describe('createTransport — takes its answers from the platform', () => {
  it('getToken comes from the session source', () => {
    const { t } = build({ session: { getToken: () => 'abc' } });
    expect(t.getToken()).toBe('abc');
    expect(t.getAccessToken()).toBe('abc');
  });

  it('readCsrfCookie comes from the cookie reader', () => {
    const { t } = build({ cookies: { readCsrf: () => 'csrf-value' } });
    expect(t.readCsrfCookie()).toBe('csrf-value');
  });

  it('mayHaveCookieSession is true when the cookie is readable', () => {
    const { t } = build({ cookies: { readCsrf: () => 'csrf-value' } });
    expect(t.mayHaveCookieSession()).toBe(true);
  });

  it('falls back to the local marker when the cookie is invisible', () => {
    // The API is routinely on another hostname, where document.cookie shows the
    // page nothing — so a valid session would otherwise read as "no session".
    const store = stubStore();
    store.set('loggedIn', 'true');
    const { t } = build({ localStore: store });
    expect(t.mayHaveCookieSession()).toBe(true);
  });

  it('is false for a browser carrying neither', () => {
    const { t } = build();
    expect(t.mayHaveCookieSession()).toBe(false);
  });

  it('clearLocalAuthState tells the session source to forget', () => {
    const forget = vi.fn();
    const { t } = build({ session: { forget } });
    t.clearLocalAuthState();
    expect(forget).toHaveBeenCalledOnce();
  });

  it('clearLocalAuthState drops the ETag cache', () => {
    // Stale validators belonging to a previous user would otherwise survive
    // into the next session on a shared device.
    const clear = vi.fn();
    const { t } = build({ etags: { clear } });
    t.clearLocalAuthState();
    expect(clear).toHaveBeenCalledOnce();
  });
});

/**
 * The native client's credential is a bearer token plus the session it belongs
 * to. The API refuses the token without the id — deliberately, because a token
 * that names no session cannot be revoked — so a transport that sends one
 * without the other produces an app that cannot authenticate at all.
 *
 * These run against `fetch`, because the header is only interesting on the
 * wire.
 */
describe('createTransport — the native session header', () => {
  const capture = () => {
    const calls = [];
    globalThis.fetch = vi.fn(async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({}),
        text: async () => '',
      };
    });
    return calls;
  };

  it('sends x-session-id beside the bearer token', async () => {
    const calls = capture();
    const { t } = build({
      session: { getToken: () => 'access-1', getSessionId: () => 'session-1' },
    });

    await t.apiClient.get('/api/notifications/unread-count');

    const { headers } = calls[0].init;
    expect(headers['Authorization']).toBe('Bearer access-1');
    expect(headers['x-session-id']).toBe('session-1');
  });

  /**
   * Web has no `getSessionId`: its session id is an HttpOnly cookie the browser
   * attaches itself. The header must simply not appear, rather than appear
   * empty — an empty one would be a tampered request to the guard.
   */
  it('omits the header entirely for a client that has no session id', async () => {
    const calls = capture();
    const { t } = build({ session: { getToken: () => 'access-1' } });

    await t.apiClient.get('/api/notifications/unread-count');

    expect(calls[0].init.headers).not.toHaveProperty('x-session-id');
  });

  it('sends no session id when there is no token to pair it with', async () => {
    const calls = capture();
    const { t } = build({
      session: { getToken: () => '', getSessionId: () => 'session-1' },
    });

    await t.apiClient.get('/api/notifications/unread-count');

    expect(calls[0].init.headers).not.toHaveProperty('x-session-id');
    expect(calls[0].init.headers).not.toHaveProperty('Authorization');
  });
});

/**
 * A client that keeps its own credential — the installed app — must not be
 * asked whether it has a session before it has had a chance to read one.
 *
 * Every test here corresponds to a way the app signed a valid user out on
 * launch. They are grouped because they are one bug with three surfaces: the
 * boot gate, the first request, and the retry after a refresh.
 */
describe('createTransport — a client that holds its own credential', () => {
  /** A session source shaped like the Capacitor one: async load, sync getters. */
  const nativeSession = ({ stored = null, resolveReady } = {}) => {
    let access = '';
    let refresh = stored?.refreshToken ?? '';
    let sid = stored?.sessionId ?? '';
    let loaded = false;
    return {
      holdsOwnCredential: () => true,
      getToken: () => access,
      getRefreshToken: () => refresh,
      getSessionId: () => sid,
      isRecoveryCredential: () => false,
      whenReady: () =>
        (resolveReady ?? Promise.resolve()).then(() => {
          loaded = true;
          return true;
        }),
      adopt: async (t) => {
        if (t?.accessToken) access = t.accessToken;
        if (t?.refreshToken) refresh = t.refreshToken;
        if (t?.sessionId) sid = t.sessionId;
      },
      forget: async () => {
        access = refresh = sid = '';
      },
      get loaded() {
        return loaded;
      },
    };
  };

  /**
   * The boot gate asked "do you have a session?" before the Keychain had been
   * read, got "no" because a WebView is never given cookies, and signed the
   * user out on every launch.
   */
  it('reports a possible session once a stored refresh token is loaded', () => {
    const session = nativeSession({ stored: { refreshToken: 'r1', sessionId: 's1' } });
    const { t } = build({ session });

    expect(t.mayHaveCookieSession()).toBe(true);
  });

  it('reports no session when nothing is stored', () => {
    const { t } = build({ session: nativeSession() });
    expect(t.mayHaveCookieSession()).toBe(false);
  });

  it('exposes the readiness promise so the boot can await the load', async () => {
    const session = nativeSession({ stored: { refreshToken: 'r1', sessionId: 's1' } });
    const { t } = build({ session });

    await t.whenSessionReady();

    expect(session.loaded).toBe(true);
  });

  it('web has nothing to wait for', () => {
    const { t } = build({ session: { whenReady: () => null } });
    expect(t.whenSessionReady()).toBeNull();
  });

  /**
   * The request path used to await `whenReady()` only for the signup handover
   * paths. For a self-custody client that meant the very first request, and the
   * refresh behind it, both went out with nothing in hand.
   */
  it('waits for the credential before an ordinary request', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const session = nativeSession({ stored: { refreshToken: 'r1' }, resolveReady: gate });

    const calls = [];
    globalThis.fetch = vi.fn(async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}), text: async () => '' };
    });

    const { t } = build({ session });
    const inFlight = t.apiClient.get('/api/posts/feed');

    // Nothing may have gone out yet: the credential is still being read.
    await Promise.resolve();
    expect(calls).toHaveLength(0);

    release();
    await inFlight;
    expect(calls).toHaveLength(1);
  });

  /**
   * After a refresh the stored token is new, but the retry replayed the ORIGINAL
   * headers — the token that had just 401'd. The second 401 arrives as `isRetry`
   * and falls through as a hard error, so a refresh that worked was thrown away.
   */
  it('replays the retry with the refreshed token, not the stale one', async () => {
    const session = nativeSession({ stored: { refreshToken: 'r1', sessionId: 's1' } });
    await session.adopt({ accessToken: 'stale', refreshToken: 'r1', sessionId: 's1' });

    const sent = [];
    globalThis.fetch = vi.fn(async (url, init) => {
      sent.push({ url: String(url), auth: init.headers?.['Authorization'] });

      if (String(url).includes('/api/auth/session/refresh')) {
        await session.adopt({ accessToken: 'fresh', refreshToken: 'r2', sessionId: 's1' });
        return {
          ok: true, status: 200, headers: { get: () => null },
          json: async () => ({ accessToken: 'fresh', refreshToken: 'r2', sessionId: 's1' }),
          text: async () => '',
        };
      }
      // The first attempt 401s; anything carrying the fresh token succeeds.
      const stale = init.headers?.['Authorization'] === 'Bearer stale';
      return {
        ok: !stale, status: stale ? 401 : 200,
        headers: { get: () => null }, json: async () => ({}), text: async () => '',
      };
    });

    const { t } = build({ session });
    await t.apiClient.get('/api/posts/feed');

    const retry = sent[sent.length - 1];
    expect(retry.url).toContain('/api/posts/feed');
    expect(retry.auth).toBe('Bearer fresh');
  });
});

/**
 * Cold start: the app is reopened after being closed.
 *
 * This is its own describe because the shape differs from every other retry in
 * a way that hid a bug. On a cold start the access token is EMPTY — it is never
 * written to disk, by design — so the first request goes out with no
 * Authorization header at all. Only the refresh token has been restored from
 * the Keychain.
 *
 * The retry therefore has to ADD a header the original request never had. A
 * retry that only ever *replaces* an existing one leaves the replay
 * uncredentialed, it 401s a second time, and because that arrives as `isRetry`
 * it falls through as a hard error — so a perfectly good stored session is
 * reported dead and the user is asked to sign in again on every launch.
 */
describe('createTransport — reopening the app after it was closed', () => {
  const coldStartSession = () => {
    let access = '';
    let refresh = 'stored-refresh';
    let sid = 'stored-session';
    return {
      holdsOwnCredential: () => true,
      getToken: () => access,
      getRefreshToken: () => refresh,
      getSessionId: () => sid,
      isRecoveryCredential: () => false,
      whenReady: () => Promise.resolve(true),
      adopt: async (t) => {
        if (t?.accessToken) access = t.accessToken;
        if (t?.refreshToken) refresh = t.refreshToken;
        if (t?.sessionId) sid = t.sessionId;
      },
    };
  };

  it('restores the session instead of demanding a fresh sign-in', async () => {
    const session = coldStartSession();
    const sent = [];

    globalThis.fetch = vi.fn(async (url, init) => {
      const u = String(url);
      sent.push({ url: u, auth: init.headers?.['Authorization'] ?? null });

      if (u.includes('/api/auth/session/refresh')) {
        const body = JSON.parse(init.body);
        // The refresh token restored from the Keychain is what authenticates.
        if (body.refreshToken !== 'stored-refresh') {
          return { ok: false, status: 401, headers: { get: () => null }, json: async () => ({}), text: async () => '' };
        }
        await session.adopt({ accessToken: 'minted', refreshToken: 'rotated', sessionId: 'stored-session' });
        return {
          ok: true, status: 200, headers: { get: () => null },
          json: async () => ({ accessToken: 'minted', refreshToken: 'rotated', sessionId: 'stored-session' }),
          text: async () => '',
        };
      }

      // The API refuses anything without a bearer token, as it does in reality.
      const authed = init.headers?.['Authorization'] === 'Bearer minted';
      // `text`, not `json`: the transport reads the body with res.text() and
      // parses it itself, so a stub that only implements json() hands it an
      // empty body and every assertion about the result sees null.
      const payload = JSON.stringify({ user: { id: 'u1' } });
      return {
        ok: authed,
        status: authed ? 200 : 401,
        headers: { get: () => null },
        json: async () => JSON.parse(payload),
        text: async () => (authed ? payload : '{}'),
      };
    });

    const { t } = build({ session });
    const body = await t.apiClient.get('/api/auth/session');

    // The session probe must succeed. If it throws, the app signs the user out.
    expect(body).toEqual({ user: { id: 'u1' } });

    const first = sent[0];
    const retry = sent[sent.length - 1];
    expect(first.auth).toBeNull(); // nothing to send yet — this is the cold start
    expect(retry.auth).toBe('Bearer minted'); // the retry must ADD the header
  });
});

/**
 * The signup handover carries its own credential.
 *
 * `verifyOtp` answers with a provider session, and the two calls after it must
 * be authenticated with exactly that session. They used to take whatever the
 * session source held — and the installed app's source holds only what it is
 * handed, which at that moment was nothing. Both calls went out with no
 * Authorization header; the account was verified at the provider and never
 * created, and the next authenticated request sent the user back to the
 * opening screen.
 */
describe('createTransport — a request that carries its own credential', () => {
  const okResponse = () => ({
    ok: true, status: 200, headers: { get: () => null },
    json: async () => ({}), text: async () => '',
  });

  it('sends the given token even when the session source holds none', async () => {
    const sent = [];
    globalThis.fetch = vi.fn(async (url, init) => {
      sent.push({ url: String(url), headers: init.headers });
      return okResponse();
    });
    const { t } = build({
      session: { holdsOwnCredential: () => true, getToken: () => '', getSessionId: () => '', whenReady: () => Promise.resolve(false) },
    });

    await t.apiClient.post('/api/auth/session/adopt', { refreshToken: 'r' }, { bearer: 'handover' });

    expect(sent[0].headers['Authorization']).toBe('Bearer handover');
  });

  it('never pairs it with a stored session id, which names a different session', async () => {
    const sent = [];
    globalThis.fetch = vi.fn(async (url, init) => {
      sent.push(init.headers);
      return okResponse();
    });
    const { t } = build({
      session: { holdsOwnCredential: () => true, getToken: () => 'old', getSessionId: () => 'old-sid' },
    });

    await t.apiClient.patch('/api/users/me', {}, { bearer: 'handover' });

    expect(sent[0]['Authorization']).toBe('Bearer handover');
    expect(sent[0]['x-session-id']).toBeUndefined();
  });

  it('does not treat its 401 as the end of the ambient session', async () => {
    const urls = [];
    globalThis.fetch = vi.fn(async (url) => {
      urls.push(String(url));
      return {
        ok: false, status: 401, headers: { get: () => null },
        json: async () => ({ message: 'Invalid token' }), text: async () => '',
      };
    });
    const forget = vi.fn();
    const onUnauthorized = vi.fn();
    const { t } = build({ session: { forget }, hooks: { onUnauthorized } });

    await expect(
      t.apiClient.post('/api/auth/session/adopt', {}, { bearer: 'handover' }),
    ).rejects.toMatchObject({ status: 401 });

    expect(urls.some((u) => u.includes('/api/auth/session/refresh'))).toBe(false);
    expect(forget).not.toHaveBeenCalled();
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});
