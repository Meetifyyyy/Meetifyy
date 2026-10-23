// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';

vi.mock('@shared/api/apiClient', async () => {
  const media = await import('@core/api/media');
  const { getMediaUrl } = media.createMediaUrls({
    apiOrigin: { privateMediaTarget: () => null },
    getBackendUrl: () => 'https://api.example.test',
  });
  return {
    getMediaUrl,
    normalizeDicebearUrl: media.normalizeDicebearUrl,
    deriveThumbnailKey: media.deriveThumbnailKey,
  };
});
vi.mock('@shared/hooks/usePresenceVisibility', () => ({ useCanSeeOthersPresence: () => true }));

const { default: Avatar } = await import('../Avatar');

const img = (c) => c.querySelector('img');
const skeleton = (c) => c.querySelector('[class*="avatarSkeleton"]');
const hidden = (c) => /imgHidden/.test(img(c).className);

/** What the WebView reports for a picture it already has. */
function reportComplete(complete) {
  Object.defineProperty(HTMLImageElement.prototype, 'complete', { configurable: true, get: () => complete });
  Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', { configurable: true, get: () => (complete ? 160 : 0) });
}

describe('Avatar reveal', () => {
  let clock;
  beforeEach(() => {
    clock = vi.spyOn(performance, 'now').mockReturnValue(1000);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    delete HTMLImageElement.prototype.complete;
    delete HTMLImageElement.prototype.naturalWidth;
  });

  it('shows a picture the browser already has on its first frame, with no skeleton', () => {
    reportComplete(true);
    const { container } = render(<Avatar src="avatars/cached-a.webp" size={32} />);
    expect(skeleton(container)).toBeNull();
    expect(hidden(container)).toBe(false);
    // And without the fade: it was never "loading".
    expect(img(container).className).toMatch(/imgInstant/);
  });

  it('holds a picture still downloading behind its (delayed) skeleton', () => {
    reportComplete(false);
    const { container } = render(<Avatar src="avatars/slow-a.webp" size={32} />);
    expect(skeleton(container)).not.toBeNull();
    expect(skeleton(container).className).toMatch(/avatarSkeletonHeld/);
    expect(hidden(container)).toBe(true);
  });

  it('reveals a picture that arrives within a frame or two without a fade', () => {
    reportComplete(false);
    const { container } = render(<Avatar src="avatars/quick-a.webp" size={32} />);
    clock.mockReturnValue(1030);
    fireEvent.load(img(container));
    expect(skeleton(container)).toBeNull();
    expect(img(container).className).toMatch(/imgInstant/);
  });

  it('keeps the fade for a picture that really had to download', () => {
    reportComplete(false);
    const { container } = render(<Avatar src="avatars/slow-b.webp" size={32} />);
    clock.mockReturnValue(1600);
    fireEvent.load(img(container));
    expect(skeleton(container)).toBeNull();
    expect(img(container).className).toMatch(/imgVisible/);
    expect(img(container).className).not.toMatch(/imgInstant/);
  });

  it('does not put the skeleton back after the first render settles', () => {
    reportComplete(true);
    const { container, rerender } = render(<Avatar src="avatars/cached-b.webp" size={32} />);
    rerender(<Avatar src="avatars/cached-b.webp" size={32} />);
    expect(skeleton(container)).toBeNull();
    expect(hidden(container)).toBe(false);
  });

  it('starts over for a different picture', () => {
    reportComplete(false);
    const { container, rerender } = render(<Avatar src="avatars/first.webp" size={32} />);
    clock.mockReturnValue(1600);
    fireEvent.load(img(container));
    expect(skeleton(container)).toBeNull();
    rerender(<Avatar src="avatars/second.webp" size={32} />);
    expect(skeleton(container)).not.toBeNull();
    expect(hidden(container)).toBe(true);
  });

  it('paints an inline picture at once', () => {
    reportComplete(false);
    const { container } = render(<Avatar src="data:image/png;base64,AAAA" size={32} />);
    expect(skeleton(container)).toBeNull();
    expect(hidden(container)).toBe(false);
  });
});
