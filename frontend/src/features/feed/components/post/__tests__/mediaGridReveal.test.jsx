// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

// What the media cache knows about: the original and (once resolved earlier)
// the thumbnail of one post image, as a launch that persisted them would.
const KNOWN = {
  'posts/seen.webp': 'https://cdn.test/posts/seen.webp',
  'posts/seen_thumb.webp': 'https://cdn.test/posts/seen_thumb.webp',
};
const cache = {
  getUrl: vi.fn(async (k) => KNOWN[k] || null),
  getSyncUrl: vi.fn((k) => KNOWN[k] || null),
  invalidate: vi.fn(),
};
vi.mock('@shared/utils/MediaCacheManager', () => ({ mediaCache: cache }));
vi.mock('@shared/api/apiClient', async () => {
  const media = await import('@core/api/media');
  const { getMediaUrl } = media.createMediaUrls({
    apiOrigin: { privateMediaTarget: () => null },
    getBackendUrl: () => 'https://api.test',
  });
  return { getMediaUrl, deriveThumbnailKey: media.deriveThumbnailKey };
});

const { default: MediaGrid } = await import('../MediaGrid');

globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };

const skeleton = (c) => c.querySelector('[class*="skeleton"]');
const post = (url) => [{ url, type: 'image', width: 800, height: 600 }];

/** What the WebView reports for a picture it already has. */
function reportComplete(complete) {
  Object.defineProperty(HTMLImageElement.prototype, 'complete', { configurable: true, get: () => complete });
  Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', { configurable: true, get: () => (complete ? 800 : 0) });
  Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', { configurable: true, get: () => (complete ? 600 : 0) });
}

describe('MediaGrid reveal', () => {
  let clock;
  beforeEach(() => {
    clock = vi.spyOn(performance, 'now').mockReturnValue(1000);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    delete HTMLImageElement.prototype.complete;
    delete HTMLImageElement.prototype.naturalWidth;
    delete HTMLImageElement.prototype.naturalHeight;
  });

  it('paints the thumbnail it already knows on the first frame, not the original', () => {
    reportComplete(false);
    render(<MediaGrid media={post('posts/seen.webp')} />);
    // The original used to be the first frame, swapped for the thumbnail a
    // moment later: a second download and a second fade for the same picture.
    expect(screen.getByAltText('Post content').getAttribute('src')).toBe('https://cdn.test/posts/seen_thumb.webp');
  });

  it('keeps the original as the first frame when no thumbnail is known yet', () => {
    reportComplete(false);
    render(<MediaGrid media={post('posts/fresh.webp')} />);
    expect(screen.getByAltText('Post content').getAttribute('src')).toBe('https://api.test/api/media/posts/fresh.webp');
  });

  it('shows a cached picture straight away: no skeleton, no hidden frame, no fade', () => {
    reportComplete(true);
    const { container } = render(<MediaGrid media={post('posts/seen.webp')} />);
    const el = screen.getByAltText('Post content');
    expect(skeleton(container)).toBeNull();
    expect(el.className).toMatch(/loaded/);
    expect(el.className).toMatch(/instant/);
    expect(el.className).not.toMatch(/loading/);
  });

  it('shows a picture that arrives within a frame or two without a fade', () => {
    reportComplete(false);
    const { container } = render(<MediaGrid media={post('posts/quick.webp')} />);
    clock.mockReturnValue(1040);
    fireEvent.load(screen.getByAltText('Post content'));
    expect(skeleton(container)).toBeNull();
    expect(screen.getByAltText('Post content').className).toMatch(/instant/);
  });

  it('keeps the fade for a picture that really had to download', () => {
    reportComplete(false);
    render(<MediaGrid media={post('posts/slow.webp')} />);
    clock.mockReturnValue(1800);
    fireEvent.load(screen.getByAltText('Post content'));
    const el = screen.getByAltText('Post content');
    expect(el.className).toMatch(/loaded/);
    expect(el.className).not.toMatch(/instant/);
  });

  it('remembers what it showed: a remount shows the same picture without a skeleton', () => {
    reportComplete(false);
    const first = render(<MediaGrid media={post('posts/seen.webp')} />);
    clock.mockReturnValue(1800);
    fireEvent.load(screen.getByAltText('Post content'));
    first.unmount();

    // Even if the browser has not got it decoded yet.
    reportComplete(false);
    const { container } = render(<MediaGrid media={post('posts/seen.webp')} />);
    expect(skeleton(container)).toBeNull();
    expect(screen.getByAltText('Post content').className).toMatch(/instant/);
  });

  it('remembers the original it fell back to when the thumbnail failed', () => {
    reportComplete(false);
    const first = render(<MediaGrid media={post('posts/nothumb.webp')} />);
    const el = screen.getByAltText('Post content');
    // The thumbnail did not load; the element was pointed at the original.
    el.setAttribute('src', 'https://cdn.test/posts/nothumb.webp');
    clock.mockReturnValue(1900);
    fireEvent.load(el);
    first.unmount();

    reportComplete(false);
    KNOWN['posts/nothumb.webp'] = 'https://cdn.test/posts/nothumb.webp';
    const { container } = render(<MediaGrid media={post('posts/nothumb.webp')} />);
    expect(skeleton(container)).toBeNull();
  });

  it('shows a cached picture in a carousel without a skeleton or a fade', () => {
    reportComplete(true);
    const media = [
      { url: 'posts/seen.webp', type: 'image', width: 800, height: 600 },
      { url: 'posts/other.webp', type: 'image', width: 600, height: 800 },
    ];
    const { container } = render(<MediaGrid media={media} />);
    expect(screen.getByAltText('Media 1').className).toMatch(/instant/);
    expect(skeleton(container)).toBeNull();
  });
});
