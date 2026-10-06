import { describe, expect, it } from 'vitest';
import {
  aspectOf, frameFor, carouselHeightRatio, carouselLayout,
  FRAME_ASPECT_MIN, FRAME_ASPECT_MAX, CAROUSEL_PEEK_MAX, CAROUSEL_HEIGHT_MIN, CAROUSEL_HEIGHT_MAX,
} from '../mediaLayout';

describe('aspectOf', () => {
  it('reads every field name the feed and composer use', () => {
    expect(aspectOf({ aspectRatio: 1.5 })).toBe(1.5);
    expect(aspectOf({ width: 1080, height: 1350 })).toBeCloseTo(0.8);
    expect(aspectOf({ raw: { width: 1920, height: 1080 } })).toBeCloseTo(16 / 9);
    expect(aspectOf({ originalWidth: 100, originalHeight: 100 })).toBe(1);
  });

  it('is null when nothing usable is declared', () => {
    expect(aspectOf({})).toBeNull();
    expect(aspectOf({ width: 0, height: 100 })).toBeNull();
    expect(aspectOf({ width: 'x', height: 3 })).toBeNull();
    expect(aspectOf(null)).toBeNull();
  });
});

describe('frameFor', () => {
  it('uses the real shape, uncropped, inside the bounds', () => {
    expect(frameFor(0.8)).toEqual({ aspect: 0.8, crop: false, known: true });
    expect(frameFor(1.91)).toEqual({ aspect: 1.91, crop: false, known: true });
  });

  it('crops only very tall or very wide media, to the nearest bound', () => {
    expect(frameFor(0.2)).toMatchObject({ aspect: FRAME_ASPECT_MIN, crop: true });
    expect(frameFor(5)).toMatchObject({ aspect: FRAME_ASPECT_MAX, crop: true });
  });

  it('marks an unknown shape as such', () => {
    expect(frameFor(null)).toMatchObject({ known: false, crop: false });
  });
});

describe('carouselHeightRatio', () => {
  it('lets a same-shape set fill the peek width exactly', () => {
    expect(carouselHeightRatio([1, 1, 1])).toBeCloseTo(CAROUSEL_PEEK_MAX);
    expect(carouselHeightRatio([0.8, 0.8])).toBeCloseTo(CAROUSEL_PEEK_MAX / 0.8);
  });

  it('is set by the widest item, whatever its position', () => {
    expect(carouselHeightRatio([0.8, 16 / 9, 1])).toBeCloseTo(CAROUSEL_PEEK_MAX / (16 / 9));
    expect(carouselHeightRatio([16 / 9, 0.8])).toBeCloseTo(CAROUSEL_PEEK_MAX / (16 / 9));
  });

  it('stays inside its bounds for extreme sets', () => {
    expect(carouselHeightRatio([10, 10])).toBeCloseTo(CAROUSEL_HEIGHT_MIN);
    expect(carouselHeightRatio([0.1, 0.1])).toBeLessThanOrEqual(CAROUSEL_HEIGHT_MAX);
  });

  it('ignores unknown shapes and has a default when none are known', () => {
    expect(carouselHeightRatio([1, null])).toBeCloseTo(carouselHeightRatio([1]));
    expect(carouselHeightRatio([null, null])).toBeCloseTo(CAROUSEL_PEEK_MAX);
  });
});

describe('carouselLayout', () => {
  const sets = [
    [1, 1, 1],
    [0.8, 16 / 9, 1, 3],
    [16 / 9, 9 / 16, 4 / 5],
    [0.2, 6],
    [2.2, 0.6],
  ];

  it('shows every tile at its own shape within the peek width: no bars, no squeeze', () => {
    for (const set of sets) {
      const { heightRatio, items } = carouselLayout(set);
      items.forEach((it) => {
        expect(heightRatio * it.aspect).toBeLessThanOrEqual(CAROUSEL_PEEK_MAX + 1e-9);
      });
    }
  });

  it('crops only the extreme shapes', () => {
    const { items } = carouselLayout([1, 16 / 9, 0.2, 6]);
    expect(items.map((i) => i.crop)).toEqual([false, false, true, true]);
  });

  it('keeps a given row height so late sizes never change it', () => {
    const frozen = carouselHeightRatio([null, null]);
    expect(carouselLayout([1.5, 0.7], frozen).heightRatio).toBe(frozen);
  });
});
