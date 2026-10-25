import { describe, expect, it } from 'vitest';
import { avatarFor } from '../components/HandleMark';

describe('avatarFor', () => {
  it('gives a name the same avatar every time, whatever its case', () => {
    expect(avatarFor('Lunar.Koi')).toEqual(avatarFor('lunar.koi'));
  });

  it('never draws the body in the background colour family', () => {
    for (let i = 0; i < 300; i += 1) {
      const { bg, ink } = avatarFor(`name${i}`);
      expect(bg).not.toBe(ink);
    }
  });

  it('spreads names across every creature and many colours', () => {
    const shapes = new Set();
    const pairs = new Set();
    for (let i = 0; i < 400; i += 1) {
      const a = avatarFor(`quiet.fox${i}`);
      shapes.add(a.art.viewBox + a.art.body.length);
      pairs.add(`${a.bg}/${a.ink}`);
    }
    expect(shapes.size).toBe(8);
    expect(pairs.size).toBeGreaterThan(40);
  });
});
