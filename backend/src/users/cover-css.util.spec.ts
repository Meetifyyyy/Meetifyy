import { isSafeCoverCss, looksLikeCoverCss } from './cover-css.util';

describe('isSafeCoverCss', () => {
  it.each([
    'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    'linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px) 0 0 / 28px 28px, linear-gradient(160deg, #0f172a 0%, #1e293b 100%)',
    'repeating-radial-gradient(circle at 100% 50%, rgba(255,255,255,0.16) 0 2px, transparent 2px 22px), linear-gradient(120deg, #0f766e 0%, #5eead4 100%)',
  ])('accepts %s', (css) => {
    expect(isSafeCoverCss(css)).toBe(true);
  });

  it.each([
    'linear-gradient(red, blue), url(https://tracker.example/p.png)',
    'linear-gradient(red, var(--x))',
    'linear-gradient(red, blue); color: red',
    'linear-gradient(red, blue',
    `linear-gradient(${'red,'.repeat(600)} blue)`,
  ])('refuses %s', (css) => {
    expect(isSafeCoverCss(css)).toBe(false);
  });

  it('does not treat uploaded covers as CSS', () => {
    expect(looksLikeCoverCss('/api/media/profile-covers/a.webp')).toBe(false);
  });
});
