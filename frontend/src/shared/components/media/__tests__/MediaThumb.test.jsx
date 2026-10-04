/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';

/**
 * MediaThumb used to paint the unsigned `/api/media/<key>` URL first (a 404 in
 * the installed app), sent no-poster videos straight to that URL, and could sit
 * on its skeleton forever when a retry produced the same URL it already had.
 */

const getSyncUrl = vi.hoisted(() => vi.fn());
const getUrl = vi.hoisted(() => vi.fn());
const invalidate = vi.hoisted(() => vi.fn());

vi.mock('@shared/utils/MediaCacheManager', () => ({
  mediaCache: { getSyncUrl, getUrl, invalidate },
}));

import MediaThumb from '../MediaThumb';

const UNSIGNED = 'https://api.test/api/media/chat/a.jpg';
const SIGNED = 'https://r2.test/chat/a.jpg?X-Amz-Signature=s';

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

describe('MediaThumb', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getSyncUrl.mockReset();
    getUrl.mockReset();
    invalidate.mockReset();
    // The cache's honest answer for conversation media: nothing synchronous.
    getSyncUrl.mockReturnValue(null);
    getUrl.mockResolvedValue(SIGNED);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    delete globalThis.IntersectionObserver;
  });

  it('never paints the unsigned URL; shows the signed one once it exists', async () => {
    const { container } = render(<MediaThumb src="chat/a.jpg" />);
    expect(container.querySelector('img')).toBeNull();
    await flush();
    const img = container.querySelector('img');
    expect(img.getAttribute('src')).toBe(SIGNED);
    expect(container.innerHTML).not.toContain(UNSIGNED);
  });

  it('retries once after a delay, re-requesting even when the URL is unchanged, then shows the unavailable tile', async () => {
    const { container } = render(<MediaThumb src="chat/a.jpg" />);
    await flush();
    const first = container.querySelector('img');
    fireEvent.error(first);

    await flush(300);
    expect(invalidate).not.toHaveBeenCalled(); // waits before retrying
    await flush(600);
    expect(invalidate).toHaveBeenCalledWith('chat/a.jpg');
    await flush(100);

    const second = container.querySelector('img');
    expect(second).not.toBeNull();
    expect(second).not.toBe(first); // remounted, so the same URL is requested again
    expect(second.getAttribute('src')).toBe(SIGNED);

    fireEvent.error(second);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByTitle('This media is no longer available')).toBeTruthy();
  });

  it('a no-poster video is signed like everything else', async () => {
    const { container } = render(<MediaThumb src="chat/v.mp4" type="video" />);
    expect(container.querySelector('video')).toBeNull();
    await flush();
    expect(getUrl).toHaveBeenCalledWith('chat/v.mp4');
    expect(container.querySelector('video').getAttribute('src')).toBe(`${SIGNED}#t=0.1`);
  });

  it('a video with a poster shows the signed poster image, not the video', async () => {
    const { container } = render(<MediaThumb src="chat/v.mp4" poster="chat/p.jpg" type="video" />);
    await flush();
    expect(getUrl).toHaveBeenCalledWith('chat/p.jpg');
    expect(getUrl).not.toHaveBeenCalledWith('chat/v.mp4');
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('img')).not.toBeNull();
  });

  it('shows the unavailable tile, not an endless skeleton, when signing is declined', async () => {
    getUrl.mockResolvedValue(null);
    const { container } = render(<MediaThumb src="chat/a.jpg" />);
    await flush();
    expect(screen.getByTitle('This media is no longer available')).toBeTruthy();
    expect(container.querySelector('img')).toBeNull();
  });

  it('does not resolve until the tile is near the viewport', async () => {
    let trigger;
    globalThis.IntersectionObserver = class {
      constructor(cb) { trigger = () => cb([{ isIntersecting: true }]); }
      observe() {}
      disconnect() {}
    };
    const { container } = render(<MediaThumb src="chat/a.jpg" />);
    await flush();
    expect(getUrl).not.toHaveBeenCalled();
    act(() => trigger());
    await flush();
    expect(getUrl).toHaveBeenCalledWith('chat/a.jpg');
    expect(container.querySelector('img')).not.toBeNull();
  });

  it('lazy={false} resolves immediately even with an IntersectionObserver present', async () => {
    globalThis.IntersectionObserver = class { observe() {} disconnect() {} };
    render(<MediaThumb src="chat/a.jpg" lazy={false} />);
    await flush();
    expect(getUrl).toHaveBeenCalled();
  });

  it('a clickable tile carries its accessible name and is keyboard operable', async () => {
    const onClick = vi.fn();
    render(<MediaThumb src="chat/a.jpg" onClick={onClick} ariaLabel="Open photo 3 of 12" />);
    const button = screen.getByRole('button', { name: 'Open photo 3 of 12' });
    fireEvent.keyDown(button, { key: 'Enter' });
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
