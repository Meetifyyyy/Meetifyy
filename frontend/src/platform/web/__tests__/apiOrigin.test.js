/**
 * The web implementation of ApiOrigin.
 *
 * This holds every `window.location` question the API transport used to ask
 * inline, so it is worth pinning: these are the rules that decide which host
 * the app talks to, and getting them wrong looks like "the backend is down"
 * rather than like a bug in a predicate.
 *
 * `window` is stubbed by hand rather than through jsdom, because what is being
 * varied is `location.hostname` and `location.protocol` — the two things jsdom
 * makes awkward to change per test, and the two things every case here turns on.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createWebApiOrigin } from '../apiOrigin';

const setLocation = (href) => {
  const u = new URL(href);
  globalThis.window = {
    location: {
      href,
      origin: u.origin,
      hostname: u.hostname,
      protocol: u.protocol,
      host: u.host,
    },
  };
};
const clearLocation = () => {
  delete globalThis.window;
};

const cfg = (over = {}) => ({
  api: {
    baseUrl: 'https://api.meetifyy.app',
    localPort: 4000,
    preferLocalBackend: false,
    proxyPrefix: '/_api',
    ...over,
  },
});

afterEach(clearLocation);

describe('baseUrl', () => {
  it('uses the configured origin on a public page', () => {
    setLocation('https://meetifyy.app/home');
    expect(createWebApiOrigin({ config: cfg() }).baseUrl()).toBe('https://api.meetifyy.app');
  });

  it('prefers the page host when preferLocalBackend and the page is local', () => {
    // What makes testing from a phone on the same Wi-Fi work.
    setLocation('http://192.168.1.5:3000/home');
    const o = createWebApiOrigin({ config: cfg({ preferLocalBackend: true }) });
    expect(o.baseUrl()).toBe('http://192.168.1.5:4000');
  });

  it('does NOT prefer the page host on a public page, even when the flag is on', () => {
    setLocation('https://meetifyy.app/home');
    const o = createWebApiOrigin({ config: cfg({ preferLocalBackend: true }) });
    expect(o.baseUrl()).toBe('https://api.meetifyy.app');
  });

  it('upgrades an http API origin when the page is https', () => {
    // A secure page cannot call an insecure origin; upgrading beats failing.
    setLocation('https://meetifyy.app/home');
    const o = createWebApiOrigin({ config: cfg({ baseUrl: 'http://api.meetifyy.app' }) });
    expect(o.baseUrl()).toBe('https://api.meetifyy.app');
  });

  it('does not upgrade a loopback API origin', () => {
    setLocation('https://meetifyy.app/home');
    const o = createWebApiOrigin({ config: cfg({ baseUrl: 'http://localhost:4000' }) });
    expect(o.baseUrl()).toBe('http://localhost:4000');
  });

  it('returns empty when nothing is configured, meaning same-origin', () => {
    setLocation('https://meetifyy.app/home');
    expect(createWebApiOrigin({ config: cfg({ baseUrl: '' }) }).baseUrl()).toBe('');
  });

  it('survives having no window at all', () => {
    clearLocation();
    expect(createWebApiOrigin({ config: cfg() }).baseUrl()).toBe('https://api.meetifyy.app');
  });
});

describe('privateMediaTarget', () => {
  it('a page on a private network rewrites media to that host', () => {
    setLocation('http://192.168.1.5:3000/home');
    expect(createWebApiOrigin({ config: cfg() }).privateMediaTarget()).toEqual({
      kind: 'local',
      base: 'http://192.168.1.5:4000',
    });
  });

  it('a public page sends media to the API', () => {
    setLocation('https://meetifyy.app/home');
    expect(createWebApiOrigin({ config: cfg() }).privateMediaTarget()).toEqual({ kind: 'api' });
  });

  it('no window means no opinion', () => {
    clearLocation();
    expect(createWebApiOrigin({ config: cfg() }).privateMediaTarget()).toBeNull();
  });

  it('localhost counts as private — which is exactly why native needs its own implementation', () => {
    // Documenting the trap rather than only fixing it: this answer is correct
    // for a browser tab on a developer's machine and wrong for a Capacitor
    // WebView, whose page origin is also `localhost`. A native ApiOrigin must
    // return { kind: 'api' } unconditionally.
    setLocation('http://localhost:3000/home');
    expect(createWebApiOrigin({ config: cfg() }).privateMediaTarget()).toEqual({
      kind: 'local',
      base: 'http://localhost:4000',
    });
  });
});

describe('fallbackBaseUrl and canFailOver', () => {
  it('builds the same-origin proxy from the page origin', () => {
    setLocation('https://meetifyy.app/home');
    expect(createWebApiOrigin({ config: cfg() }).fallbackBaseUrl()).toBe(
      'https://meetifyy.app/_api',
    );
  });

  it('is null without a window', () => {
    clearLocation();
    expect(createWebApiOrigin({ config: cfg() }).fallbackBaseUrl()).toBeNull();
  });

  it('can fail over when the API is on a different host', () => {
    setLocation('https://meetifyy.app/home');
    expect(createWebApiOrigin({ config: cfg() }).canFailOver()).toBe(true);
  });

  it('cannot fail over on localhost — there is no proxy to find the API behind', () => {
    setLocation('http://localhost:3000/home');
    expect(createWebApiOrigin({ config: cfg() }).canFailOver()).toBe(false);
  });

  it('cannot fail over when the API is already same-origin', () => {
    setLocation('https://meetifyy.app/home');
    const o = createWebApiOrigin({ config: cfg({ baseUrl: 'https://meetifyy.app' }) });
    expect(o.canFailOver()).toBe(false);
  });
});
