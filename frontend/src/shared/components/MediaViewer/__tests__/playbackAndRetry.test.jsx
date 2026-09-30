/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import ImageViewer from '../ImageViewer';
import VideoViewer from '../VideoViewer';
const mocks = vi.hoisted(() => ({
  source: { src: 'video.mp4', failed: false, pending: false }, refresh: vi.fn(),
  register: vi.fn(() => vi.fn()), requestPlay: vi.fn(), notifyPause: vi.fn(),
}));
vi.mock('@shared/hooks/useSignedMediaSrc', () => ({
  useSignedMediaSrc: () => ({ ...mocks.source, refresh: mocks.refresh }),
}));
vi.mock('@shared/utils/feedVideoRegistry', () => ({ feedVideoRegistry: mocks }));
let play;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.source = { src: 'video.mp4', failed: false, pending: false };
  play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('viewer playback and image recovery', () => {
  it('plays and registers only the current video and pauses on deselection', () => {
    const result = render(<><VideoViewer src="a.mp4" isCurrent /><VideoViewer src="b.mp4" isCurrent={false} /></>);
    expect(play).toHaveBeenCalledTimes(1);
    expect(mocks.register).toHaveBeenCalledTimes(1);
    const firstId = mocks.register.mock.calls[0][0];
    result.rerender(<><VideoViewer src="a.mp4" isCurrent={false} /><VideoViewer src="b.mp4" isCurrent /></>);
    expect(play).toHaveBeenCalledTimes(2);
    expect(mocks.register).toHaveBeenCalledTimes(2);
    expect(mocks.register.mock.calls[1][0]).not.toBe(firstId);
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  });
  it('does not autoplay when a neighboring video source arrives later', () => {
    mocks.source.src = '';
    const result = render(<VideoViewer src="private.mp4" isCurrent={false} />);
    mocks.source.src = 'signed.mp4';
    result.rerender(<VideoViewer src="private.mp4" isCurrent={false} />);
    expect(play).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
    expect(result.container.querySelector('video').getAttribute('preload')).toBe('metadata');
  });
  it('shows image signing failure and offers a fresh retry', () => {
    mocks.source = { src: '', failed: true, pending: false };
    const result = render(<ImageViewer src="private.png" />);
    expect(screen.getByText('Media unavailable')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(mocks.refresh).toHaveBeenCalledOnce();
    mocks.source = { src: '', failed: false, pending: true };
    result.rerender(<ImageViewer src="private.png" />);
    expect(screen.queryByText('Media unavailable')).toBeNull();
  });
  it('remounts an image after a network error when retrying the same public URL', () => {
    mocks.source.src = 'image.png';
    const result = render(<ImageViewer src="image.png" />);
    const original = result.container.querySelector('img');
    fireEvent.error(original);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(result.container.querySelector('img')).not.toBe(original);
    expect(result.container.querySelector('img').getAttribute('src')).toBe('image.png');
  });
});
