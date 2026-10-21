/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { revealOverlap } from '../useKeyboardOverlayForm';

// 800px tall screen with a 300px keyboard: it covers everything below y=500.
const base = { bodyTop: 60, viewportHeight: 800, inset: 300, margin: 12 };

describe('revealOverlap', () => {
  it('leaves a field that is already above the keyboard alone', () => {
    expect(revealOverlap({ ...base, fieldRect: { top: 300, bottom: 348 } })).toBe(0);
  });

  it('scrolls a field that is behind the keyboard by exactly the overlap', () => {
    // The field may end at 500 - 12 = 488. One ending at 530 is 42px too low.
    expect(revealOverlap({ ...base, fieldRect: { top: 482, bottom: 530 } })).toBe(42);
  });

  it('never scrolls a tall field past its own top', () => {
    expect(revealOverlap({ ...base, fieldRect: { top: 100, bottom: 900 } })).toBe(100 - 60 - 12);
  });
});
