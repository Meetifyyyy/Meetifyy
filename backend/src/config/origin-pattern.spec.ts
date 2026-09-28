import { originMatchesPattern } from './origin-pattern';

/**
 * CORS origin patterns (CORS_ORIGIN_PATTERNS, and `*` entries in
 * CORS_ORIGINS). CodeQL #60 and #72: only `.` was escaped, so any other
 * regex metacharacter in a configured pattern changed its meaning.
 */
describe('originMatchesPattern', () => {
  it('matches one label per `*`, and nothing more', () => {
    const p = 'https://*.vercel.app';
    expect(originMatchesPattern(p, 'https://preview-1.vercel.app')).toBe(true);
    expect(originMatchesPattern(p, 'https://PREVIEW-1.vercel.app')).toBe(true);
    expect(originMatchesPattern(p, 'https://a.b.vercel.app')).toBe(false);
    expect(originMatchesPattern(p, 'https://avercel.app')).toBe(false);
    expect(originMatchesPattern(p, 'https://x.vercel.app.evil.com')).toBe(
      false,
    );
    expect(originMatchesPattern(p, 'http://x.vercel.app')).toBe(false);
  });

  it('treats every other character literally', () => {
    const p = 'https://a+b.*.app';
    expect(originMatchesPattern(p, 'https://a+b.x.app')).toBe(true);
    expect(originMatchesPattern(p, 'https://aab.x.app')).toBe(false);
    expect(originMatchesPattern('https://(x|y).*.app', 'https://y.z.app')).toBe(
      false,
    );
    expect(originMatchesPattern('https://a\\d.*.app', 'https://a1.z.app')).toBe(
      false,
    );
  });

  it('leaves exact entries and the bare wildcard to the caller as before', () => {
    expect(
      originMatchesPattern('https://meetifyy.app', 'https://meetifyy.app'),
    ).toBe(false);
    expect(originMatchesPattern('*', 'https://anything.example')).toBe(true);
  });
});
