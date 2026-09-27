import { describe, it, expect } from 'vitest';
import { pageGradientColorAt } from '../pageEdgeColors';
import { adaptMediaQuery } from '../landscapePhoneMedia';

const vars = {
  '--bg-gradient-center': '#ffffff',
  '--bg-gradient-mid': '#f0f5fc',
  '--bg-gradient-edge': '#cfe0f7',
};
const read = (name) => vars[name];

describe('pageGradientColorAt', () => {
  it('is the centre colour at the centre and the edge colour at the corner', () => {
    expect(pageGradientColorAt(200, 400, 400, 800, read)).toMatchObject({ r: 255, g: 255, b: 255 });
    expect(pageGradientColorAt(0, 0, 400, 800, read)).toMatchObject({ r: 0xcf, g: 0xe0, b: 0xf7 });
  });

  it('is between mid and edge just above the top edge, where the status bar sits', () => {
    const c = pageGradientColorAt(200, -12, 400, 800, read);
    expect(c.b).toBeGreaterThan(0xf7 - 1);
    expect(c.r).toBeLessThan(0xf0);
    expect(c.r).toBeGreaterThan(0xcf);
  });

  it('gives up when a stop is missing rather than inventing a colour', () => {
    expect(pageGradientColorAt(0, 0, 400, 800, () => '')).toBeNull();
  });
});

describe('adaptMediaQuery (landscape phones keep the mobile layout)', () => {
  it('lets a short landscape screen take the small-screen branch', () => {
    expect(adaptMediaQuery('(max-width: 768px)')).toBe('(max-width: 768px), (max-device-height: 500px)');
  });

  it('keeps short screens out of the large-screen branch', () => {
    expect(adaptMediaQuery('(min-width: 769px)')).toBe('(min-width: 769px) and (min-device-height: 501px)');
  });

  it('never lets a landscape phone into a tablet range', () => {
    const q = adaptMediaQuery('(min-width: 769px) and (max-width: 1100px)');
    expect(q).toBe(
      '(min-width: 769px) and (max-width: 1100px) and (min-device-height: 501px), '
      + '(min-width: 769px) and (max-device-height: 500px) and (min-device-height: 501px)',
    );
  });

  it('is idempotent, so a re-visiting PostCSS pass settles', () => {
    const once = adaptMediaQuery('(max-width: 768px)');
    expect(adaptMediaQuery(once)).toBe(once);
  });

  it('leaves phone-only breakpoints and non-width queries alone', () => {
    expect(adaptMediaQuery('(max-width: 480px)')).toBe('(max-width: 480px)');
    expect(adaptMediaQuery('(prefers-color-scheme: dark)')).toBe('(prefers-color-scheme: dark)');
  });
});
