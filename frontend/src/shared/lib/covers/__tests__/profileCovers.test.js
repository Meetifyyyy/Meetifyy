import { describe, expect, it } from 'vitest';
import { COVER_GRADIENTS, COVER_PATTERNS, isSameCover } from '../profileCovers';
import { isSafeCoverCss } from '../coverCss';
import { getCleanCoverUrl } from '@shared/components/ui/CoverImage';

describe('cover library', () => {
  it.each([...COVER_PATTERNS, ...COVER_GRADIENTS].map((d) => [d.id, d]))(
    '%s passes the safe-CSS gate and renders as a gradient cover',
    (_id, design) => {
      expect(isSafeCoverCss(design.css)).toBe(true);
      expect(getCleanCoverUrl(design.css)).toEqual({ isGradient: true, gradient: design.css });
    },
  );

  it('has unique ids and at least six patterns', () => {
    const ids = [...COVER_PATTERNS, ...COVER_GRADIENTS].map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(COVER_PATTERNS.length).toBeGreaterThanOrEqual(6);
  });

  it('a stored design keeps rendering once it is no longer in the library', () => {
    const retired = 'radial-gradient(circle at 50% 50%, #fff 0 10%, transparent 11%), linear-gradient(#000, #111)';
    expect([...COVER_PATTERNS, ...COVER_GRADIENTS].some((d) => isSameCover(retired, d))).toBe(false);
    expect(getCleanCoverUrl(retired).isGradient).toBe(true);
  });

  it('matches a stored copy regardless of whitespace and case', () => {
    expect(isSameCover(`  ${COVER_GRADIENTS[0].css.toUpperCase()} `, COVER_GRADIENTS[0])).toBe(true);
  });
});

describe('isSafeCoverCss', () => {
  it.each([
    'linear-gradient(red, blue), url(https://tracker.example/p.png)',
    'linear-gradient(red, var(--x))',
    'linear-gradient(red, blue); background: red',
    'linear-gradient(red, blue)) , image-set(x)',
    'linear-gradient(red, "blue")',
    'linear-gradient(red, blue',
    `linear-gradient(${'red,'.repeat(600)} blue)`,
  ])('refuses %s', (css) => {
    expect(isSafeCoverCss(css)).toBe(false);
    expect(getCleanCoverUrl(css)).toEqual({ isEmpty: true });
  });

  it('leaves uploaded and legacy covers alone', () => {
    expect(getCleanCoverUrl('/api/media/profile-covers/a.webp').url).toContain('/api/media/profile-covers/a.webp');
    expect(getCleanCoverUrl(null)).toEqual({ isEmpty: true });
  });
});
