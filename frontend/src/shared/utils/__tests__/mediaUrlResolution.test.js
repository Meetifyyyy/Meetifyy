import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * `getMediaUrl` is the single answer to "which origin serves this?", and three
 * separate bugs came from rendering a stored value without asking it: post
 * images, chat gallery tiles and the media viewer all pointed a relative
 * `/api/media/<key>` path at the app's own origin, which is the static
 * frontend and has no such route.
 */
describe('getMediaUrl', () => {
  let getMediaUrl;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubGlobal('window', {
      location: { hostname: 'dev.meetifyy.app', protocol: 'https:', origin: 'https://dev.meetifyy.app' },
      addEventListener: () => {},
    });
    vi.stubEnv('VITE_API_URL', 'https://api.example.test');
    ({ getMediaUrl } = await import('../../api/apiClient'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('sends a relative /api/media path to the API origin, not the page origin', () => {
    const url = getMediaUrl('/api/media/posts/abc.webp');
    expect(url).toBe('https://api.example.test/api/media/posts/abc.webp');
    expect(url.startsWith('https://dev.meetifyy.app')).toBe(false);
  });

  it('turns a bare object key into a full media URL', () => {
    expect(getMediaUrl('chat/abc.webp')).toBe('https://api.example.test/api/media/chat/abc.webp');
  });

  it('leaves an absolute URL alone, so resolving twice is harmless', () => {
    const absolute = 'https://pub-abc.r2.dev/posts/abc.webp';
    expect(getMediaUrl(absolute)).toBe(absolute);
    expect(getMediaUrl(getMediaUrl(absolute))).toBe(absolute);
  });

  it('leaves data: and blob: URLs alone', () => {
    expect(getMediaUrl('data:image/png;base64,AAA')).toBe('data:image/png;base64,AAA');
    expect(getMediaUrl('blob:https://x/y')).toBe('blob:https://x/y');
  });

  it('returns an empty string for nothing, rather than a bare API path', () => {
    // A bare '/api/media/' would be a request for the whole folder.
    expect(getMediaUrl('')).toBe('');
    expect(getMediaUrl(null)).toBe('');
    expect(getMediaUrl(undefined)).toBe('');
  });
});

/**
 * Private origins must never survive into a public page.
 *
 * Media URLs written during local development carry whatever origin that
 * machine had. Handing one to an <img> on the deployed site is not merely a
 * dead image: the browser treats it as the site reaching into the VIEWER's own
 * network, and Chrome 138+ interrupts with "dev.meetifyy.app wants to access
 * other devices on your local network".
 *
 * The old rewrite matched exactly `localhost` or `127.0.0.1` on the configured
 * local port. Every other shape a developer's machine produces passed straight
 * through, which is the hole these cover.
 */
describe('getMediaUrl and private network origins', () => {
  let getMediaUrl;

  const loadOnPublicPage = async (apiUrl = 'https://api.example.test') => {
    vi.resetModules();
    vi.stubGlobal('window', {
      location: { hostname: 'dev.meetifyy.app', protocol: 'https:', origin: 'https://dev.meetifyy.app' },
      addEventListener: () => {},
    });
    vi.stubEnv('VITE_API_URL', apiUrl);
    ({ getMediaUrl } = await import('../../api/apiClient'));
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('rewrites a localhost origin to the API', async () => {
    await loadOnPublicPage();
    expect(getMediaUrl('http://localhost:4000/api/media/chat/a.webp'))
      .toBe('https://api.example.test/api/media/chat/a.webp');
  });

  it('rewrites a LAN IP, which used to pass through untouched', async () => {
    // The case behind the browser prompt.
    await loadOnPublicPage();
    expect(getMediaUrl('http://192.168.1.5:4000/api/media/chat/a.webp'))
      .toBe('https://api.example.test/api/media/chat/a.webp');
  });

  it('rewrites a localhost origin on a NON-default port', async () => {
    // The old pattern pinned the port, so 3000 escaped.
    await loadOnPublicPage();
    expect(getMediaUrl('http://127.0.0.1:3000/api/media/chat/a.webp'))
      .toBe('https://api.example.test/api/media/chat/a.webp');
  });

  it('rewrites Tailscale and .local addresses', async () => {
    await loadOnPublicPage();
    expect(getMediaUrl('http://100.101.102.103:4000/api/media/x.webp'))
      .toBe('https://api.example.test/api/media/x.webp');
    expect(getMediaUrl('http://sarthak-macbook.local:4000/api/media/x.webp'))
      .toBe('https://api.example.test/api/media/x.webp');
  });

  it('preserves the path and query when rewriting', async () => {
    await loadOnPublicPage();
    expect(getMediaUrl('http://192.168.0.9:4000/api/media/a.webp?v=2'))
      .toBe('https://api.example.test/api/media/a.webp?v=2');
  });

  it('drops a private URL entirely when there is no API to rewrite it to', async () => {
    // Returning the original would put the private request back on the page.
    // An empty string lets the caller fall back to its own placeholder.
    await loadOnPublicPage('');
    expect(getMediaUrl('http://192.168.1.5:4000/api/media/a.webp')).toBe('');
  });

  it('leaves public absolute URLs completely alone', async () => {
    await loadOnPublicPage();
    const cdn = 'https://pub-abc.r2.dev/posts/abc.webp';
    expect(getMediaUrl(cdn)).toBe(cdn);
  });
});

describe('getMediaUrl on a page that is itself on the local network', () => {
  // A developer on their own machine, or a phone testing over the same Wi-Fi.
  // Here the private backend is genuinely reachable and must keep working.
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('points a stored local URL at the host actually being browsed', async () => {
    vi.resetModules();
    vi.stubGlobal('window', {
      location: { hostname: '192.168.1.20', protocol: 'http:', origin: 'http://192.168.1.20' },
      addEventListener: () => {},
    });
    vi.stubEnv('VITE_API_URL', 'https://api.example.test');
    vi.stubEnv('VITE_API_LOCAL_PORT', '4000');
    const { getMediaUrl } = await import('../../api/apiClient');

    // Written on the developer's laptop as localhost; browsed from a phone.
    expect(getMediaUrl('http://localhost:4000/api/media/a.webp'))
      .toBe('http://192.168.1.20:4000/api/media/a.webp');
  });
});
