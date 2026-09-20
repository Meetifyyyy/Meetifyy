/**
 * Blocker B1, asserted.
 *
 * Inside a Capacitor WebView the page origin is `https://localhost` on Android
 * and `capacitor://localhost` on iOS. The web implementation derives the API
 * host from `window.location`, so on a device it concludes "this client is on
 * the local network" and points the app at `https://localhost:4000` — or, on
 * iOS, `capacitor://localhost:4000`, because the protocol comes from the page
 * too. The same reasoning was in `getMediaUrl`, where it would have rewritten
 * every private-origin image to the same place.
 *
 * These tests exist because that failure reads as "the backend is down" rather
 * than as a client bug, and because it cannot be caught by grepping the bundle:
 * the first attempt at a CI guard searched for `localhost:NNNN` in
 * `dist-mobile/` and failed on a default constant inside @supabase/auth-js.
 * What matters is not whether the string appears anywhere, it is what this
 * function returns.
 *
 * A `window` is deliberately installed in the first block, reproducing exactly
 * what a WebView presents. If this implementation ever starts consulting it,
 * these fail.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createCapacitorApiOrigin } from '../apiOrigin';

const API = 'https://api.meetifyy.app';
const cfg = (over = {}) => ({
  api: { baseUrl: API, localPort: 4000, preferLocalBackend: true, proxyPrefix: '/_api', ...over },
});

const asWebView = (href) => {
  const u = new URL(href.replace(/^capacitor:/, 'https:'));
  globalThis.window = {
    location: {
      href,
      origin: href.replace(/\/$/, ''),
      hostname: u.hostname,
      protocol: href.startsWith('capacitor:') ? 'capacitor:' : u.protocol,
      host: u.host,
    },
  };
};
afterEach(() => { delete globalThis.window; });

describe('the WebView origin never leaks into the API origin', () => {
  it.each([
    ['Android', 'https://localhost/'],
    ['iOS', 'capacitor://localhost/'],
  ])('%s: baseUrl is the configured API, not the page', (_platform, href) => {
    asWebView(href);
    // preferLocalBackend is ON here on purpose. It is the flag that makes the
    // web implementation prefer the page's own host, and it must make no
    // difference at all to this one.
    const o = createCapacitorApiOrigin({ config: cfg() });
    expect(o.baseUrl()).toBe(API);
    expect(o.baseUrl()).not.toContain('localhost');
    expect(o.baseUrl()).not.toContain('capacitor:');
  });

  it.each([
    ['Android', 'https://localhost/'],
    ['iOS', 'capacitor://localhost/'],
  ])('%s: private media goes to the API, never to the page host', (_platform, href) => {
    asWebView(href);
    const o = createCapacitorApiOrigin({ config: cfg() });
    // `{ kind: 'local' }` would mean "rewrite the image to this device's own
    // host", which is the exact shape of the bug.
    expect(o.privateMediaTarget()).toEqual({ kind: 'api' });
  });

  it('answers identically with no window at all', () => {
    const o = createCapacitorApiOrigin({ config: cfg() });
    expect(o.baseUrl()).toBe(API);
    expect(o.privateMediaTarget()).toEqual({ kind: 'api' });
  });
});

describe('no failover', () => {
  it('has no same-origin fallback', () => {
    // A native app has no second origin serving the same content. Returning a
    // proxy prefix would send requests to the WebView's own static file server,
    // which knows nothing about /api and would answer a confusing 404.
    const o = createCapacitorApiOrigin({ config: cfg() });
    expect(o.fallbackBaseUrl()).toBeNull();
    expect(o.canFailOver()).toBe(false);
  });
});

describe('configuration', () => {
  it('sends realtime to the same origin as the API', () => {
    expect(createCapacitorApiOrigin({ config: cfg() }).socketUrl()).toBe(API);
  });

  it('refuses to construct without an API URL', () => {
    // On web an empty origin means "same origin", which is a working setup. A
    // bundled app has none, so every request would silently go to the local
    // file server. Failing at construction beats failing per-request.
    expect(() => createCapacitorApiOrigin({ config: cfg({ baseUrl: '' }) })).toThrow(
      /VITE_API_URL is required/,
    );
  });

  it('uses the configured origin verbatim', () => {
    const o = createCapacitorApiOrigin({ config: cfg({ baseUrl: 'https://staging-api.example' }) });
    expect(o.baseUrl()).toBe('https://staging-api.example');
  });
});
