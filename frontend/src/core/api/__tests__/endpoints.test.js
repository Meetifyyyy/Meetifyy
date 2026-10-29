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
  'confessionsApi',
  'campusAffiliationApi',
  'accountEmailApi',
  'reauthApi',
  'notificationsApi',
  'pushApi',
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

  it('exposes 236 methods in total', () => {
    // A blunt guard, on purpose: this number changed to 191 when the endpoints
    // were lifted out of apiClient.js, and it is what catches a namespace being
    // dropped by a future refactor of this file. Update it deliberately when an
    // endpoint is genuinely added or removed.
    const { transport } = stubTransport();
    const api = createEndpoints(transport);
    const total = Object.values(api).reduce((n, ns) => n + Object.keys(ns).length, 0);
    expect(total).toBe(236); // +activitiesApi.decline; 235 +groupApi getInviteLinkPreview/createInviteLink/resetInviteLinks/getJoinRequestActivity; 231 +messagesApi.getUnreadSummary; 230 +dmApi.sendGroupInvite; 229 +confessionsApi.sync; 228 confessionsApi relate/unrelate → get/react/unreact; 227 +reauthApi (methods/withPassword/sendCode/withCode); 223 +confessionsApi (getMe/checkHandle/createProfile/list/create/relate/unrelate/remove); 215 +pushApi (getConfig/registerDevice/unregisterDevice/getPreferences/updatePreferences); 210 +usersApi.snoozeProfilePrompt; 198 + campusAffiliationApi (get/sendOtp/verify/remove/listColleges/requestCollege) + accountEmailApi (get/sendOtp/verify) + legalApi (listVersions/getVersion)
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

  it('maps the college-affiliation and account-email calls onto the contract', () => {
    const { calls, transport } = stubTransport();
    const api = createEndpoints(transport);
    api.campusAffiliationApi.get();
    api.campusAffiliationApi.sendOtp({ collegeId: 'c1', email: 'a@uni.edu' });
    api.campusAffiliationApi.verify({ code: '123456' });
    api.campusAffiliationApi.sendOtp({ collegeId: 'c2', email: 'b@uni.edu', reauthToken: 'g1' });
    api.campusAffiliationApi.verify({ code: '123456', reauthToken: 'g1' });
    api.campusAffiliationApi.remove({ reauthToken: 'g2' });
    api.campusAffiliationApi.requestCollege({
      name: 'Asha', collegeName: 'New College', collegeEmail: 'a@new.edu', personalEmail: 'a@mail.com', city: 'x',
    });
    api.accountEmailApi.sendOtp({ email: 'me@mail.com', reauthToken: 'g3' });
    api.accountEmailApi.verify({ code: '654321', reauthToken: 'g3' });
    api.reauthApi.methods();
    api.reauthApi.withPassword({ purpose: 'college_email_remove', password: 'pw' });
    api.reauthApi.sendCode({ purpose: 'personal_email_change' });
    api.reauthApi.withCode({ purpose: 'personal_email_change', code: '111111' });
    expect(calls).toEqual([
      { method: 'GET', path: '/api/campus/affiliation', rest: [] },
      { method: 'POST', path: '/api/campus/affiliation/otp', rest: [{ collegeId: 'c1', email: 'a@uni.edu' }] },
      { method: 'POST', path: '/api/campus/affiliation/verify', rest: [{ code: '123456' }] },
      // A first verification sends no grant; a change sends one.
      {
        method: 'POST',
        path: '/api/campus/affiliation/otp',
        rest: [{ collegeId: 'c2', email: 'b@uni.edu', reauthToken: 'g1' }],
      },
      { method: 'POST', path: '/api/campus/affiliation/verify', rest: [{ code: '123456', reauthToken: 'g1' }] },
      // Removal carries the grant, never a password.
      { method: 'DELETE', path: '/api/campus/affiliation', rest: [{ body: { reauthToken: 'g2' } }] },
      // Only the DTO's four fields: the server forbids unknown ones.
      {
        method: 'POST',
        path: '/api/auth/request-college',
        rest: [{ name: 'Asha', collegeName: 'New College', collegeEmail: 'a@new.edu', personalEmail: 'a@mail.com' }],
      },
      { method: 'POST', path: '/api/account/email/otp', rest: [{ email: 'me@mail.com', reauthToken: 'g3' }] },
      { method: 'POST', path: '/api/account/email/verify', rest: [{ code: '654321', reauthToken: 'g3' }] },
      { method: 'GET', path: '/api/account/reauth', rest: [] },
      {
        method: 'POST',
        path: '/api/account/reauth/password',
        rest: [{ purpose: 'college_email_remove', password: 'pw' }],
      },
      { method: 'POST', path: '/api/account/reauth/code', rest: [{ purpose: 'personal_email_change' }] },
      {
        method: 'POST',
        path: '/api/account/reauth/code/verify',
        rest: [{ purpose: 'personal_email_change', code: '111111' }],
      },
    ]);
  });

  it('builds query strings from arguments rather than from ambient state', () => {
    const { calls, transport } = stubTransport();
    const api = createEndpoints(transport);
    api.communitiesApi.getRecommendations(5);
    expect(calls[0].path).toBe('/api/communities/recommendations?limit=5');
  });

  it('sends Explore filters only when they are set', () => {
    const { calls, transport } = stubTransport();
    const api = createEndpoints(transport);
    api.communitiesApi.explore();
    api.communitiesApi.explore({ search: 'chess club', visibility: 'private', offset: 30 });
    api.communitiesApi.getMine();
    expect(calls.map((c) => c.path)).toEqual([
      '/api/communities?limit=30&offset=0',
      '/api/communities?limit=30&offset=30&search=chess+club&visibility=private',
      '/api/communities/mine',
    ]);
  });

  describe('supportApi.uploadAttachment (a raw fetch, outside the transport)', () => {
    const upload = async (transport) => {
      const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ key: 'k' }) });
      vi.stubGlobal('fetch', fetchSpy);
      try {
        await createEndpoints(transport).supportApi.uploadAttachment(new Blob(['x']));
      } finally {
        vi.unstubAllGlobals();
      }
      return fetchSpy.mock.calls[0][1].headers;
    };

    it('names the installed app\'s session beside the bearer, which the guard requires', async () => {
      const { transport } = stubTransport();
      const headers = await upload({ ...transport, getSessionId: () => 'sess-9' });
      expect(headers).toEqual({ Authorization: 'Bearer stub-token', 'x-session-id': 'sess-9' });
    });

    it('sends no session header on the web, where a cookie carries it', async () => {
      const { transport } = stubTransport();
      const headers = await upload(transport);
      expect(headers).toEqual({ Authorization: 'Bearer stub-token' });
    });
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

describe('logoutSession', () => {
  const make = (getRefreshToken) => {
    const post = vi.fn().mockResolvedValue({});
    const { authApi } = createEndpoints({
      apiClient: { post, get: vi.fn() },
      getToken: () => '',
      getBackendUrl: () => 'https://api.test',
      getRefreshToken,
    });
    return { post, authApi };
  };

  it('names the session by its refresh token when the client holds one (the app)', async () => {
    const { post, authApi } = make(() => 'app-refresh');
    await authApi.logoutSession();
    expect(post).toHaveBeenCalledWith('/api/auth/session/logout', { refreshToken: 'app-refresh' });
  });

  it('sends no body on web, where the refresh token is an HttpOnly cookie', async () => {
    const { post, authApi } = make(undefined);
    await authApi.logoutSession();
    expect(post).toHaveBeenCalledWith('/api/auth/session/logout', undefined);
  });
});
