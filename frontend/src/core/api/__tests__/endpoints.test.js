/**
 * The endpoint factory's contract.
 *
 * These endpoints are the one layer the web app, the Capacitor app and a future
 * React Native app all share, so what is verified here is not "does the feed
 * load" — the app's own tests cover that — but the three properties that make
 * sharing possible at all:
 *
 *   1. the factory takes its transport as an argument and reaches for nothing
 *      else, so a second client can supply a different one;
 *   2. it hands back every namespace the callers expect, under the same names;
 *   3. it builds request paths the same way regardless of who calls it.
 *
 * Running in the default `node` environment is itself part of the test: if
 * anything in `core/api/endpoints.js` ever reaches for a browser global, these
 * fail rather than silently working on web and breaking on a device.
 */
import { describe, it, expect, vi } from 'vitest';
import { createEndpoints } from '../endpoints';

/** A transport that records calls instead of making them. */
function stubTransport() {
  const calls = [];
  const record = (method) => (path, ...rest) => {
    calls.push({ method, path, rest });
    return Promise.resolve({ ok: true });
  };
  return {
    calls,
    transport: {
      apiClient: {
        get: record('GET'),
        post: record('POST'),
        patch: record('PATCH'),
        put: record('PUT'),
        delete: record('DELETE'),
      },
      getToken: () => 'stub-token',
      getBackendUrl: () => 'https://api.example.test',
    },
  };
}

const EXPECTED_NAMESPACES = [
  'authApi',
  'postsApi',
  'shareApi',
  'linkPreviewApi',
  'communitiesApi',
  'activitiesApi',
  'sessionsApi',
  'usersApi',
  'dmApi',
  'groupApi',
  'instantMatchApi',
  'messagesApi',
  'healthApi',
  'uploadsApi',
  'campusEventsApi',
  'notificationsApi',
  'searchApi',
  'reportsApi',
  'legalApi',
  'supportApi',
];

describe('createEndpoints', () => {
  it('returns exactly the expected namespaces', () => {
    const { transport } = stubTransport();
    const api = createEndpoints(transport);
    expect(Object.keys(api).sort()).toEqual([...EXPECTED_NAMESPACES].sort());
  });

  it('every namespace is a non-empty object of functions', () => {
    const { transport } = stubTransport();
    const api = createEndpoints(transport);
    for (const name of EXPECTED_NAMESPACES) {
      const ns = api[name];
      expect(ns, name).toBeTypeOf('object');
      const methods = Object.entries(ns);
      expect(methods.length, `${name} has no methods`).toBeGreaterThan(0);
      for (const [method, fn] of methods) {
        expect(fn, `${name}.${method}`).toBeTypeOf('function');
      }
    }
  });

  it('exposes 191 methods in total', () => {
    // A blunt guard, on purpose: this number changed to 191 when the endpoints
    // were lifted out of apiClient.js, and it is what catches a namespace being
    // dropped by a future refactor of this file. Update it deliberately when an
    // endpoint is genuinely added or removed.
    const { transport } = stubTransport();
    const api = createEndpoints(transport);
    const total = Object.values(api).reduce((n, ns) => n + Object.keys(ns).length, 0);
    expect(total).toBe(191);
  });

  it('is a factory, not a singleton — two calls yield independent objects', () => {
    // This is the property that keeps web and mobile from sharing one mutable
    // client. If these ever compare equal, the endpoints have acquired module
    // state and two clients would be talking through one object.
    const a = createEndpoints(stubTransport().transport);
    const b = createEndpoints(stubTransport().transport);
    expect(a).not.toBe(b);
    expect(a.postsApi).not.toBe(b.postsApi);
  });

  it('routes calls through the injected transport and nothing else', () => {
    const { calls, transport } = stubTransport();
    const api = createEndpoints(transport);

    api.communitiesApi.getAll();
    api.communitiesApi.getById('abc');
    api.communitiesApi.join('abc');

    expect(calls).toEqual([
      { method: 'GET', path: '/api/communities', rest: [] },
      { method: 'GET', path: '/api/communities/abc', rest: [] },
      { method: 'POST', path: '/api/communities/abc/join', rest: [undefined, { signal: undefined }] },
    ]);
  });

  it('builds query strings from arguments rather than from ambient state', () => {
    const { calls, transport } = stubTransport();
    const api = createEndpoints(transport);
    api.communitiesApi.getRecommendations(5);
    expect(calls[0].path).toBe('/api/communities/recommendations?limit=5');
  });

  it('a second client with a different transport is fully isolated', () => {
    // The whole point of the factory, stated as a test: two clients, two
    // transports, no shared state, no leakage between them.
    const web = stubTransport();
    const mobile = stubTransport();
    const webApi = createEndpoints(web.transport);
    const mobileApi = createEndpoints(mobile.transport);

    webApi.communitiesApi.getAll();
    expect(web.calls).toHaveLength(1);
    expect(mobile.calls).toHaveLength(0);

    mobileApi.postsApi.getFeed?.();
    mobileApi.communitiesApi.getById('x');
    // The web client saw nothing new: each set of endpoints talks only to the
    // transport it was built with.
    expect(web.calls).toHaveLength(1);
    expect(mobile.calls.map((c) => c.path)).toContain('/api/communities/x');
  });

  it('does not touch the transport at construction time', () => {
    // Construction must be inert. A factory that calls its transport while
    // being built cannot be created before auth is ready, which is exactly when
    // a composition root needs to create it.
    const spy = {
      apiClient: {
        get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn(),
      },
      getToken: vi.fn(),
      getBackendUrl: vi.fn(),
    };
    createEndpoints(spy);
    for (const fn of Object.values(spy.apiClient)) expect(fn).not.toHaveBeenCalled();
    expect(spy.getToken).not.toHaveBeenCalled();
    expect(spy.getBackendUrl).not.toHaveBeenCalled();
  });
});
