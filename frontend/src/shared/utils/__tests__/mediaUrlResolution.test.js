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
