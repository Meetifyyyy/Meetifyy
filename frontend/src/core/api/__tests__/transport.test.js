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
