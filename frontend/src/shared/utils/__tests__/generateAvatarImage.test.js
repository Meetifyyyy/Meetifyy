import { describe, it, expect } from 'vitest';
import { centredGlyphOrigin } from '../generateAvatarImage';

describe('centredGlyphOrigin', () => {
  it('puts the ink of a capital in the middle of the square, both ways', () => {
    // A capital whose ink spans 100 wide and 160 tall, drawn from a baseline.
    const metrics = {
      actualBoundingBoxLeft: 48,
      actualBoundingBoxRight: 52,
      actualBoundingBoxAscent: 160,
      actualBoundingBoxDescent: 0,
    };
    const { x, y } = centredGlyphOrigin(metrics, 512);
    // Ink runs from x-left to x+right and from y-ascent to y+descent.
    expect(x - 48 + (48 + 52) / 2).toBeCloseTo(256);
    expect(y - 160 + (160 + 0) / 2).toBeCloseTo(256);
  });

  it('accounts for a letter that dips below the baseline', () => {
    const metrics = {
      actualBoundingBoxLeft: 40,
      actualBoundingBoxRight: 40,
      actualBoundingBoxAscent: 150,
      actualBoundingBoxDescent: 30,
    };
    const { y } = centredGlyphOrigin(metrics, 512);
    expect(y - 150 + (150 + 30) / 2).toBeCloseTo(256);
  });

  it('says so when the canvas cannot measure ink', () => {
    expect(centredGlyphOrigin({}, 512)).toBeNull();
    expect(centredGlyphOrigin({ actualBoundingBoxLeft: 0, actualBoundingBoxRight: 0, actualBoundingBoxAscent: 0, actualBoundingBoxDescent: 0 }, 512)).toBeNull();
    expect(centredGlyphOrigin(undefined, 512)).toBeNull();
  });
});
