/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { revealOverlap } from '../useLiftedActionBar';

// 800px tall screen; the keyboard is 300px (48px of it the navigation bar the
// action bar's own padding covers), the bar is 80px tall with that padding.
const base = { bodyTop: 60, viewportHeight: 800, lift: 252, barHeight: 80, margin: 12 };

describe('revealOverlap', () => {
  it('leaves a field that is already above the lifted bar alone', () => {
    expect(revealOverlap({ ...base, fieldRect: { top: 300, bottom: 348 } })).toBe(0);
  });

  it('scrolls a field that is behind the bar by exactly the overlap', () => {
    // The bar's top is at 800 - 252 - 80 = 468; with the margin, the field may
    // end at 456. A field ending at 500 is 44px too low.
    expect(revealOverlap({ ...base, fieldRect: { top: 452, bottom: 500 } })).toBe(44);
  });

  it('counts the bar, not just the keyboard', () => {
    // 440 clears the keyboard's top (500) but not the bar sitting on it.
    expect(revealOverlap({ ...base, fieldRect: { top: 392, bottom: 440 + 40 } })).toBeGreaterThan(0);
  });

  it('never scrolls a tall field past its own top', () => {
    const tall = { top: 100, bottom: 900 };
    expect(revealOverlap({ ...base, fieldRect: tall })).toBe(100 - 60 - 12);
  });
});
