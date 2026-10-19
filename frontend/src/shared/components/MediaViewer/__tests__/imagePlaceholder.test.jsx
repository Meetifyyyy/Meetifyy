/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';

/*
 * Opening an image used to start from an empty stage: the opener showed a
 * thumbnail, the viewer asked for the full original (a URL nothing had fetched)
 * and showed a grey skeleton for the whole download, then popped the picture
 * in. Measured on a chat image: 25 frames (~420 ms) of skeleton. The viewer
 * now starts on the thumbnail it was handed and swaps once the original has
 * decoded.
 */
vi.mock('@shared/hooks/useSignedMediaSrc', () => ({
  useSignedMediaSrc: (value) => ({
    src: value || '', failed: false, pending: false, refresh: vi.fn(), recover: () => false, attempt: 0,
  }),
}));
vi.mock('../VideoViewer', () => ({ default: () => <video /> }));

const { default: ImageViewer } = await import('../ImageViewer');

afterEach(cleanup);

const full = (c) => c.querySelector('img:not([data-viewer-placeholder])');
const placeholder = (c) => c.querySelector('img[data-viewer-placeholder]');
const skeleton = (c) => c.querySelector('[class*="skeleton"]');

describe('opening on the opener’s thumbnail', () => {
  it('shows the thumbnail, not a skeleton, while the original loads', () => {
    const { container } = render(<ImageViewer src="full.jpg" placeholder="thumb.webp" />);
    expect(placeholder(container)?.getAttribute('src')).toBe('thumb.webp');
    expect(skeleton(container)).toBeNull();
    expect(full(container).style.opacity).toBe('0');
  });

  it('swaps only after the original has decoded, without a fade', async () => {
    const { container } = render(<ImageViewer src="full.jpg" placeholder="thumb.webp" />);
    const img = full(container);
    let finishDecode;
    img.decode = () => new Promise((resolve) => { finishDecode = resolve; });

    act(() => { fireEvent.load(img); });
    // Loaded but not decoded: the thumbnail is still what is on screen.
    expect(placeholder(container)).not.toBeNull();
    expect(img.style.opacity).toBe('0');

    await act(async () => { finishDecode(); });
    expect(placeholder(container)).toBeNull();
    expect(img.style.opacity).toBe('1');
    expect(img.style.transition).toBe('none');
  });

  it('keeps the skeleton when the opener had nothing to hand over', () => {
    const { container } = render(<ImageViewer src="full.jpg" />);
    expect(placeholder(container)).toBeNull();
    expect(skeleton(container)).not.toBeNull();
  });
});
