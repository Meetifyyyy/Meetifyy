/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  FEED_SCROLL_KEY,
  forgetRowSizes,
  readSavedFeedScroll,
  recallRowSizes,
  rememberRowSizes,
  saveFeedScroll,
} from '../feedScrollMemory';

describe('feed scroll position', () => {
  beforeEach(() => sessionStorage.clear());

  it('round-trips a position and reads 0 when nothing is saved', () => {
    expect(readSavedFeedScroll()).toBe(0);
    saveFeedScroll(1234.6);
    expect(sessionStorage.getItem(FEED_SCROLL_KEY)).toBe('1235');
    expect(readSavedFeedScroll()).toBe(1235);
  });

  it('ignores garbage and negative values', () => {
    sessionStorage.setItem(FEED_SCROLL_KEY, 'abc');
    expect(readSavedFeedScroll()).toBe(0);
    saveFeedScroll(-50);
    expect(readSavedFeedScroll()).toBe(0);
  });
});

describe('remembered row heights', () => {
  beforeEach(() => forgetRowSizes());

  it('seeds the virtualizer with what was measured at the same width', () => {
    rememberRowSizes(new Map([['a', 300], ['b', 410]]), 390);

    expect(recallRowSizes(390).map(({ key, size }) => [key, size])).toEqual([
      ['a', 300],
      ['b', 410],
    ]);
  });

  it('discards heights measured at a different width', () => {
    rememberRowSizes(new Map([['a', 300]]), 390);

    expect(recallRowSizes(1280)).toEqual([]);

    // A later save at the new width replaces, not merges with, the old layout.
    rememberRowSizes(new Map([['b', 500]]), 1280);
    expect(recallRowSizes(1280).map((r) => r.key)).toEqual(['b']);
    expect(recallRowSizes(390)).toEqual([]);
  });

  it('keeps later measurements and skips unusable sizes', () => {
    rememberRowSizes(new Map([['a', 300], ['bad', 0]]), 390);
    rememberRowSizes(new Map([['a', 320]]), 390);

    expect(recallRowSizes(390).map(({ key, size }) => [key, size])).toEqual([['a', 320]]);
  });
});
