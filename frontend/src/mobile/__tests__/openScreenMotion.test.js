import { describe, it, expect } from 'vitest';
import { circlesAt, stepSpring } from '../openScreenMotion';

const SIZES = [
  [320, 568], [360, 640], [360, 800], [375, 667], [390, 844], [412, 915],
  [768, 1024], [1024, 768], [844, 390], [800, 360], [568, 320], [1280, 800],
];

describe('circlesAt', () => {
  it('never lets two circles overlap, at any size, at rest or mid-swipe', () => {
    for (const [w, h] of SIZES) {
      for (let pos = 0; pos <= 2.0001; pos += 0.02) {
        const cs = circlesAt(pos, w, h, 2);
        for (let i = 0; i < cs.length; i += 1) {
          for (let j = i + 1; j < cs.length; j += 1) {
            const d = Math.hypot(cs[i].x - cs[j].x, cs[i].y - cs[j].y);
            expect(d, `${w}x${h} at ${pos.toFixed(2)}: circles ${i} and ${j}`).toBeGreaterThanOrEqual(
              cs[i].r + cs[j].r + 7.99,
            );
          }
        }
      }
    }
  });

  it('gives each slide its own arrangement: every circle moves to a new place', () => {
    const [a, b, c] = [0, 1, 2].map((p) => circlesAt(p, 390, 844, 2));
    for (let i = 0; i < 3; i += 1) {
      expect(Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y)).toBeGreaterThan(100);
      expect(Math.hypot(b[i].x - c[i].x, b[i].y - c[i].y)).toBeGreaterThan(100);
    }
  });

  it('scales with the screen: the same composition on a phone and a tablet', () => {
    const phone = circlesAt(0, 390, 844, 2);
    const tablet = circlesAt(0, 780, 1688, 2);
    phone.forEach((c, i) => {
      expect(tablet[i].x).toBeCloseTo(c.x * 2, 0);
      expect(tablet[i].y).toBeCloseTo(c.y * 2, 0);
      expect(tablet[i].r).toBeCloseTo(c.r * 2, 0);
    });
  });

  it('keeps a circle a circle: one radius, never a stretch', () => {
    for (const c of circlesAt(0.37, 844, 390, 2)) {
      expect(Number.isFinite(c.r)).toBe(true);
      expect(c.r).toBeGreaterThan(0);
    }
  });
});

describe('stepSpring', () => {
  const settle = (x, v, target) => {
    let s = { x, v };
    let maxPast = 0;
    for (let i = 0; i < 120; i += 1) {
      s = stepSpring(s, target, 1 / 60);
      maxPast = Math.max(maxPast, (s.x - target) * Math.sign(target - x || 1));
    }
    return { s, maxPast };
  };

  it('settles on the target', () => {
    const { s } = settle(0, 0, 1);
    expect(s.x).toBeCloseTo(1, 3);
    expect(Math.abs(s.v)).toBeLessThan(0.01);
  });

  it('does not overshoot from rest', () => {
    expect(settle(0, 0, 1).maxPast).toBeLessThan(0.001);
  });

  it('keeps a flick’s speed at release and still does not overshoot noticeably', () => {
    // 4 slides/s is a hard flick on a phone (~1600 px/s).
    const first = stepSpring({ x: 0.3, v: 4 }, 1, 1 / 60);
    expect(first.v).toBeGreaterThan(3); // no sudden drop at the hand-over
    expect(settle(0.3, 4, 1).maxPast).toBeLessThan(0.02);
  });

  it('survives a long stalled frame without flinging', () => {
    const s = stepSpring({ x: 0, v: 0 }, 1, 2);
    expect(s.x).toBeLessThanOrEqual(1.001);
  });
});
