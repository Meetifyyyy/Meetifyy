/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Conditional GETs must never be able to answer a caller with an error.
 *
 * The client stores ETags but not bodies, so a 304 it provokes has nothing to
 * be served from — it arrived with an empty body and fell through as
 * `API error 304`. Invisible cross-origin, because `ETag` is not an exposed
 * response header there and nothing was ever stored; live the moment the app
 * and the API share an origin, which is both a normal deployment shape and what
 * this client's own proxy failover produces.
 *
 * It sat in front of `GET /api/auth/session`, so on the second load of a tab
 * the boot read a thrown error as "no session" and signed the user out.
 */

vi.mock('@shared/lib/supabase', () => ({
  supabase: null,
  isRecoveryTab: () => false,
  clearRecoveryTab: () => {},
}));
vi.mock('@config', () => ({
  // `false` because these exercise the WEB client. The constant gates which
  // API origin apiClient assembles, and a mock that omits it fails the import
  // outright rather than defaulting — which is how these tests found it.
  IS_MOBILE_BUILD: false,
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

const response = ({ status = 200, body = '{}', headers = {} }) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (k) => headers[k] ?? headers[k.toLowerCase()] ?? null },
  json: async () => JSON.parse(body || '{}'),
  text: async () => body,
});

describe('conditional GETs', () => {
  let apiClient;

  beforeEach(async () => {
    vi.resetModules();
    sessionStorage.clear();
    ({ apiClient } = await import('@shared/api/apiClient'));
  });
  afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); });

  it('does not remember an ETag on a no-store response', async () => {
    // Every auth route is no-store, so the browser never holds a body to
    // satisfy the conditional request the token would provoke.
    const fetchMock = vi.fn(async () =>
      response({
        body: '{"user":{"id":"u1"}}',
        headers: { ETag: 'W/"abc"', 'Cache-Control': 'no-store, no-cache' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await apiClient.get('/api/auth/session');
    await apiClient.get('/api/auth/session');

    const second = fetchMock.mock.calls[1][1];
    expect(second.headers['If-None-Match']).toBeUndefined();
  });

  it('recovers from a 304 instead of surfacing it as an error', async () => {
    let call = 0;
    const fetchMock = vi.fn(async (_url, init) => {
      call += 1;
      if (call === 1) {
        return response({
          body: '{"a":1}',
          headers: { ETag: 'W/"abc"', 'Cache-Control': 'private, max-age=60' },
        });
      }
      // The conditional one. Empty body, and nothing on this side to fill it.
      if (init.headers['If-None-Match']) return response({ status: 304, body: '' });
      return response({ body: '{"a":2}' });
    });
    vi.stubGlobal('fetch', fetchMock);

    await apiClient.get('/api/campus/anything');
    const result = await apiClient.get('/api/campus/anything');

    expect(result).toEqual({ a: 2 });
    expect(call).toBe(3);
  });
});
