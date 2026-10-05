/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { isThumbnailMissing, markThumbnailMissing, _resetMissingThumbnails } from '../missingThumbnails';

describe('missingThumbnails', () => {
  beforeEach(() => {
    localStorage.clear();
    _resetMissingThumbnails();
    vi.useRealTimers();
  });

  it('remembers a missing thumbnail across a reload', () => {
    markThumbnailMissing('posts/a_thumb.webp');
    _resetMissingThumbnails(); // a new launch reads it back from storage
    expect(isThumbnailMissing('posts/a_thumb.webp')).toBe(true);
    expect(isThumbnailMissing('posts/b_thumb.webp')).toBe(false);
  });

  it('forgets after a day, so a thumbnail that later appears is used', () => {
    vi.useFakeTimers();
    markThumbnailMissing('posts/a_thumb.webp');
    vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);
    expect(isThumbnailMissing('posts/a_thumb.webp')).toBe(false);
  });

  it('stays bounded', () => {
    for (let i = 0; i < 400; i += 1) markThumbnailMissing(`posts/${i}_thumb.webp`);
    expect(isThumbnailMissing('posts/0_thumb.webp')).toBe(false);
    expect(isThumbnailMissing('posts/399_thumb.webp')).toBe(true);
  });

  it('survives unusable storage', () => {
    localStorage.setItem('meetifyy_missing_thumbs_v1', '{not json');
    expect(isThumbnailMissing('posts/a_thumb.webp')).toBe(false);
  });
});
