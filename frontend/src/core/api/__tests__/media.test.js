/**
 * Media URL resolution, and the WebView bug it exists to prevent.
 *
 * `getMediaUrl` used to decide what to do with a private-origin URL by reading
 * `window.location.hostname`. Inside a Capacitor WebView that hostname is
 * `localhost`, which reads as "this client is on the local network" — so every
 * image whose stored URL named a developer's LAN address would have been
 * rewritten to `capacitor://localhost:4000/...` and silently failed to load on
 * every device.
 *
 * The decision is now the platform's to make, and the native case is asserted
 * below rather than left to be discovered on a phone.
 */
import { describe, it, expect } from 'vitest';
import {
  createMediaUrls,
  deriveThumbnailKey,
  getPastelBgColor,
  isPrivateNetworkHost,
  normalizeDicebearUrl,
} from '../media';

const API = 'https://api.meetifyy.test';

/** A platform that behaves like a browser tab on a developer's own machine. */
const webOnLan = {
  privateMediaTarget: () => ({ kind: 'local', base: 'http://192.168.1.5:4000' }),
};
/** A browser tab on the deployed public site. */
const webPublic = { privateMediaTarget: () => ({ kind: 'api' }) };
/** A native shell: never "on the local network", whatever its page origin says. */
const native = { privateMediaTarget: () => ({ kind: 'api' }) };
/** No location at all — server render, a test harness. */
const nowhere = { privateMediaTarget: () => null };

const build = (apiOrigin, backend = API) =>
  createMediaUrls({ apiOrigin, getBackendUrl: () => backend }).getMediaUrl;

describe('isPrivateNetworkHost', () => {
  it.each([
    'localhost', '127.0.0.1', '192.168.1.5', '10.0.0.8', '172.16.0.1',
    '100.64.1.2', 'mac-mini.local',
  ])('%s is private', (h) => expect(isPrivateNetworkHost(h)).toBe(true));

  it.each(['meetifyy.app', 'api.meetifyy.app', 'cdn.example.com'])(
    '%s is public',
    (h) => expect(isPrivateNetworkHost(h)).toBe(false),
  );
});

describe('getMediaUrl — private origins', () => {
  const stored = 'http://192.168.1.5:4000/api/media/avatars/a.webp';

  it('a client on that network is pointed at the local host', () => {
    expect(build(webOnLan)(stored)).toBe(
      'http://192.168.1.5:4000/api/media/avatars/a.webp',
    );
  });

  it('a public client is pointed at the configured API instead', () => {
    expect(build(webPublic)(stored)).toBe(`${API}/api/media/avatars/a.webp`);
  });

  it('NATIVE never rewrites to localhost — the WebView regression guard', () => {
    // The whole point. A native client's page origin is `localhost`, so the old
    // `window.location` reasoning would have produced a localhost URL here.
    const out = build(native)(stored);
    expect(out).toBe(`${API}/api/media/avatars/a.webp`);
    expect(out).not.toContain('localhost');
    expect(out).not.toContain('capacitor://');
  });

  it('a client that cannot tell where it is leaves the URL alone', () => {
    // Matching the old behaviour when `window` was undefined: guessing is worse
    // than doing nothing.
    expect(build(nowhere)(stored)).toBe(stored);
  });

  it('returns empty rather than a private URL when there is no API to fall back to', () => {
    expect(build(webPublic, '')(stored)).toBe('');
  });

  it('leaves public absolute URLs untouched on every platform', () => {
    const pub = 'https://cdn.example.com/x.webp';
    for (const p of [webOnLan, webPublic, native, nowhere]) {
      expect(build(p)(pub)).toBe(pub);
    }
  });
});

describe('getMediaUrl — keys and other shapes', () => {
  const url = build(webPublic);

  it('turns a bare key into an API media path', () => {
    expect(url('avatars/a.webp')).toBe(`${API}/api/media/avatars/a.webp`);
  });

  it('does not double-prefix an existing media path', () => {
    expect(url('/api/media/avatars/a.webp')).toBe(`${API}/api/media/avatars/a.webp`);
  });

  it('refuses values that cannot be a media key', () => {
    // A stray initial or label produced `GET /api/media/H`, which the backend
    // answered with 400 on every render.
    expect(url('H')).toBe('');
    expect(url('Sarthak')).toBe('');
  });

  it.each([['', ''], [null, ''], [undefined, ''], [42, '']])(
    'returns empty for %s',
    (input, expected) => expect(url(input)).toBe(expected),
  );

  it('passes data: and blob: through', () => {
    expect(url('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    expect(url('blob:https://x/y')).toBe('blob:https://x/y');
  });

  it('normalises a DiceBear URL on the way through', () => {
    expect(url('https://api.dicebear.com/7.x/thumbs/svg?seed=a')).toContain(
      'backgroundColor=b6e3f4',
    );
  });
});

describe('pure helpers', () => {
  it('getPastelBgColor is deterministic and always in the palette', () => {
    const palette = ['b6e3f4', 'c084fc', 'fde047', '86efac', 'fca5a5', 'fdba74', 'a5f3fc', 'f472b6'];
    expect(getPastelBgColor('alice')).toBe(getPastelBgColor('alice'));
    for (const seed of ['', 'a', 'alice', 'a-very-long-seed-value']) {
      expect(palette).toContain(getPastelBgColor(seed));
    }
  });

  it('normalizeDicebearUrl leaves an explicit backgroundColor alone', () => {
    const withBg = 'https://api.dicebear.com/7.x/thumbs/svg?seed=a&backgroundColor=ff0000';
    expect(normalizeDicebearUrl(withBg)).toBe(withBg);
  });

  it('normalizeDicebearUrl ignores non-DiceBear input', () => {
    expect(normalizeDicebearUrl('https://example.com/a.png')).toBe('https://example.com/a.png');
  });

  it('deriveThumbnailKey follows the folder/name_thumb.webp convention', () => {
    expect(deriveThumbnailKey('avatars/abc.webp')).toBe('avatars/abc_thumb.webp');
    expect(deriveThumbnailKey(`${API}/api/media/posts/xyz.jpg`)).toBe('posts/xyz_thumb.webp');
  });

  it.each([
    ['already a thumb', 'avatars/abc_thumb.webp'],
    ['a data URL', 'data:image/png;base64,AA'],
    ['an external URL', 'https://cdn.example.com/a.webp'],
    ['no folder', 'abc.webp'],
    ['nothing', ''],
  ])('deriveThumbnailKey returns null for %s', (_l, input) => {
    expect(deriveThumbnailKey(input)).toBeNull();
  });
});
