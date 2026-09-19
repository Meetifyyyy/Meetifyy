/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The renewal path, which is what stops a session ending after an hour.
 *
 * The access cookie's lifetime is the Supabase token's own — about an hour —
 * and nothing renewed it. `/api/auth/session/refresh` existed on the server and
 * had ZERO callers: the provider data shows one refresh-token rotation across
 * the whole life of the project. So a session simply expired, every request
 * after that came back 401, and the app signed the user out with a perfectly
 * good session still in the database.
 *
 * The fix is not a longer token. It is asking the server — which holds the
 * refresh token — to rotate, and replaying the request once.
 */

vi.mock('@shared/lib/supabase', () => ({
  supabase: null,
  isRecoveryTab: () => false,
  clearRecoveryTab: () => {},
}));
vi.mock('@config', () => ({
  config: {
    supabase: { url: 'https://proj.supabase.co', anonKey: 'k' },
    api: { baseUrl: 'http://api.test', proxyPrefix: '/api-proxy' },
  },
  IS_DEV_BUILD: false,
}));
vi.mock('@shared/lib/accountStatusCorrection', () => ({ applyAccountStatusCorrection: () => {} }));
vi.mock('@shared/lib/legalConsent', () => ({
  announceLegalConsentChange: () => {},
  LEGAL_ACK_REQUIRED_CODE: 'LEGAL_ACK_REQUIRED',
}));

const reply = ({ status = 200, body = '{}' }) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  json: async () => JSON.parse(body || '{}'),
  text: async () => body,
});

describe('an expired access cookie', () => {
  let mod;

  beforeEach(async () => {
    vi.resetModules();
    localStorage.clear();
    sessionStorage.clear();
    mod = await import('@shared/api/apiClient');
  });
  afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

  it('is renewed through the server, and the request replayed once', async () => {
    const calls = [];
    const fetchMock = vi.fn(async (url, init) => {
      calls.push(`${init.method} ${new URL(url).pathname}`);
      if (url.endsWith('/api/auth/session/refresh')) {
        return reply({ body: '{"csrfToken":"rotated-token","sessionId":"s2"}' });
      }
      // 401 the first time, succeed on the replay.
      const alreadyRetried = calls.filter((c) => c.endsWith('/api/posts/feed')).length > 1;
      return alreadyRetried ? reply({ body: '{"posts":[]}' }) : reply({ status: 401, body: '{}' });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await mod.apiClient.get('/api/posts/feed');

    expect(calls).toEqual([
      'GET /api/posts/feed',
      'POST /api/auth/session/refresh',
      'GET /api/posts/feed',
    ]);
    expect(result).toEqual({ posts: [] });
  });

  it('rotates once for a burst of simultaneous 401s, not once each', async () => {
    // A route mount fires a dozen requests at once. A dozen simultaneous
    // rotations of the same refresh token is indistinguishable from a replay,
    // and the server burns the whole session family when it sees one.
    let refreshes = 0;
    const seen = new Set();
    const fetchMock = vi.fn(async (url, init) => {
      if (url.endsWith('/api/auth/session/refresh')) {
        refreshes += 1;
        await new Promise((r) => setTimeout(r, 5));
        return reply({ body: '{"csrfToken":"rotated-token"}' });
      }
      if (seen.has(url)) return reply({ body: '{"ok":true}' });
      seen.add(url);
      return reply({ status: 401, body: '{}' });
    });
    vi.stubGlobal('fetch', fetchMock);

    await Promise.all([
      mod.apiClient.get('/api/posts/feed'),
      mod.apiClient.get('/api/notifications'),
      mod.apiClient.get('/api/messages'),
    ]);

    expect(refreshes).toBe(1);
  });

  it('echoes the rotated CSRF token on the replay of a mutation', async () => {
    const headers = [];
    const fetchMock = vi.fn(async (url, init) => {
      if (url.endsWith('/api/auth/session/refresh')) {
        return reply({ body: '{"csrfToken":"rotated-token"}' });
      }
      headers.push(init.headers['x-csrf-token']);
      return headers.length > 1 ? reply({ body: '{}' }) : reply({ status: 401, body: '{}' });
    });
    vi.stubGlobal('fetch', fetchMock);

    await mod.apiClient.post('/api/posts/abc/like');

    // The rotation issues a NEW mf_csrf cookie, so replaying with the old token
    // would be refused by the double-submit check.
    expect(headers[1]).toBe('rotated-token');
  });

  it('does NOT sign out when the rotation could not be attempted', async () => {
    // A 429 because the rate limiter lost Redis and fails closed, a 502
    // mid-deploy, a gateway timeout. None of these say the session is over —
    // and because every tab renews on roughly the same hourly cadence, reading
    // them as "expired" signs out everybody at once, from a cache outage.
    const unauthorized = vi.fn();
    window.addEventListener('auth:unauthorized', unauthorized);
    localStorage.setItem('loggedIn', 'true');

    const fetchMock = vi.fn(async (url) =>
      url.endsWith('/api/auth/session/refresh')
        ? reply({ status: 429, body: '{"message":"slow down"}' })
        : reply({ status: 401, body: '{}' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await mod.apiClient.get('/api/posts/feed').catch(() => {});

    expect(unauthorized).not.toHaveBeenCalled();
    expect(localStorage.getItem('loggedIn')).toBe('true');
    window.removeEventListener('auth:unauthorized', unauthorized);
  });

  it('does NOT sign out when the network is simply unreachable', async () => {
    const unauthorized = vi.fn();
    window.addEventListener('auth:unauthorized', unauthorized);
    localStorage.setItem('loggedIn', 'true');

    const fetchMock = vi.fn(async (url) => {
      if (url.endsWith('/api/auth/session/refresh')) throw new TypeError('Failed to fetch');
      return reply({ status: 401, body: '{}' });
    });
    vi.stubGlobal('fetch', fetchMock);

    await mod.apiClient.get('/api/posts/feed').catch(() => {});

    expect(unauthorized).not.toHaveBeenCalled();
    expect(localStorage.getItem('loggedIn')).toBe('true');
    window.removeEventListener('auth:unauthorized', unauthorized);
  });

  it('signs out only when the rotation itself is refused', async () => {
    const unauthorized = vi.fn();
    window.addEventListener('auth:unauthorized', unauthorized);
    localStorage.setItem('loggedIn', 'true');
    localStorage.setItem('currentUser', '{"id":"u1"}');

    const fetchMock = vi.fn(async (url) =>
      url.endsWith('/api/auth/session/refresh')
        ? reply({ status: 401, body: '{}' })
        : reply({ status: 401, body: '{}' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await mod.apiClient.get('/api/posts/feed').catch(() => {});

    expect(unauthorized).toHaveBeenCalled();
    expect(localStorage.getItem('loggedIn')).toBeNull();
    expect(localStorage.getItem('currentUser')).toBeNull();
    window.removeEventListener('auth:unauthorized', unauthorized);
  });
});
