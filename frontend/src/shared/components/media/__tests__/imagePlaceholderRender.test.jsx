/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@shared/utils/MediaCacheManager', () => ({
  mediaCache: { getUrl: async (u) => u, getSyncUrl: (u) => u, invalidate: () => {} },
}));
vi.mock('../../../utils/MediaCacheManager', () => ({
  mediaCache: { getUrl: async (u) => u, getSyncUrl: (u) => u, invalidate: () => {} },
}));
vi.mock('@shared/api/apiClient', () => ({
  getMediaUrl: (u) => u,
  deriveThumbnailKey: () => null,
}));

const { default: MediaGrid } = await import('../../../../features/feed/components/post/MediaGrid');

const PH = `data:image/webp;base64,${btoa('RIFF \u0000\u0000\u0000WEBPVP8 abcdefghijklmnopqrstuvwxyz')}`;

beforeEachSetup();
function beforeEachSetup() {
  globalThis.IntersectionObserver = class {
    observe() {} unobserve() {} disconnect() {}
  };
}
afterEach(() => { cleanup(); vi.useRealTimers(); });

const skeleton = (c) => c.querySelector('[class*="skeleton"]');

describe('MediaGrid blur-up placeholder', () => {
  const one = (extra = {}) => [{ url: 'https://x/a.webp', type: 'image', width: 800, height: 600, ...extra }];

  it('paints the placeholder instead of the skeleton, under the declared frame', () => {
    const { container } = render(<MediaGrid media={one({ placeholder: PH })} />);
    const ph = screen.getByTestId('image-placeholder');
    expect(ph.style.backgroundImage).toContain(PH);
    expect(skeleton(container)).toBeNull();
    // The tile keeps the aspect-ratio reservation it always had.
    expect(container.querySelector('[style*="--aspect"]')).not.toBeNull();
  });

  it('renders the skeleton exactly as before when there is no placeholder', () => {
    const { container } = render(<MediaGrid media={one()} />);
    expect(screen.queryByTestId('image-placeholder')).toBeNull();
    expect(skeleton(container)).not.toBeNull();
  });

  it('ignores a placeholder that is not a safe WebP/JPEG data URL', () => {
    const { container } = render(
      <MediaGrid media={one({ placeholder: 'https://evil.test/x.png' })} />,
    );
    expect(screen.queryByTestId('image-placeholder')).toBeNull();
    expect(skeleton(container)).not.toBeNull();
  });

  it('fades the placeholder out once the image has loaded, then removes it', () => {
    vi.useFakeTimers();
    // A real download: it takes longer than a cached picture would (see
    // shared/utils/imageReveal), so the blur is bridged to the image.
    const clock = vi.spyOn(performance, 'now');
    clock.mockReturnValue(1000);
    render(<MediaGrid media={one({ placeholder: PH })} />);
    const img = screen.getByAltText('Post content');
    Object.defineProperty(img, 'naturalWidth', { value: 800 });
    Object.defineProperty(img, 'naturalHeight', { value: 600 });
    clock.mockReturnValue(1600);
    fireEvent.load(img);
    clock.mockRestore();
    expect(screen.getByTestId('image-placeholder').className).toMatch(/done/);
    act(() => { vi.advanceTimersByTime(700); });
    expect(screen.queryByTestId('image-placeholder')).toBeNull();
  });

  it('uses each tile\'s own placeholder in a multi-image carousel', () => {
    const media = [
      { url: 'https://x/carousel-a.webp', type: 'image', width: 800, height: 600, placeholder: PH },
      { url: 'https://x/carousel-b.webp', type: 'image', width: 600, height: 800 },
    ];
    const { container } = render(<MediaGrid media={media} />);
    expect(screen.getAllByTestId('image-placeholder')).toHaveLength(1);
    expect(container.querySelectorAll('[class*="skeleton"]')).toHaveLength(1);
  });
});

describe('ImagePlaceholder', () => {
  it('renders nothing when mounted for an image that has already loaded', async () => {
    const { default: ImagePlaceholder } = await import('../ImagePlaceholder');
    render(<ImagePlaceholder src={PH} done />);
    expect(screen.queryByTestId('image-placeholder')).toBeNull();
  });
});

describe('ImagePlaceholder for a cached image', () => {
  it('is taken away at once when the image came out of the cache', async () => {
    const { default: ImagePlaceholder } = await import('../ImagePlaceholder');
    const { rerender } = render(<ImagePlaceholder src={PH} />);
    expect(screen.getByTestId('image-placeholder')).toBeTruthy();
    rerender(<ImagePlaceholder src={PH} done instant />);
    expect(screen.queryByTestId('image-placeholder')).toBeNull();
  });

  it('still bridges a real download: it fades out rather than vanishing', async () => {
    const { default: ImagePlaceholder } = await import('../ImagePlaceholder');
    const { rerender } = render(<ImagePlaceholder src={PH} />);
    rerender(<ImagePlaceholder src={PH} done />);
    expect(screen.getByTestId('image-placeholder').className).toMatch(/done/);
  });
});
