/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const signed = vi.hoisted(() => ({
  state: { src: 'https://signed.example/a.webm', failed: false, pending: false, attempt: 0 },
  refresh: vi.fn(),
}));
vi.mock('@shared/hooks/useSignedMediaSrc', () => ({
  useSignedMediaSrc: (value) => (value
    ? { ...signed.state, refresh: signed.refresh }
    : { src: '', failed: false, pending: false, attempt: 0, refresh: signed.refresh }),
}));
vi.mock('@shared/utils/MediaCacheManager', () => ({
  mediaCache: { getSyncUrl: (v) => v, getUrl: vi.fn(async (v) => v), invalidate: vi.fn() },
}));

import VoiceMessagePlayer from '../VoiceMessagePlayer';
import { VideoPlayerWithOverlay } from '../MessageBubble';
import { feedVideoRegistry } from '@shared/utils/feedVideoRegistry';
import { PLAYBACK_PRIORITY } from '@shared/utils/playbackPriority';

beforeEach(() => {
  vi.clearAllMocks();
  signed.state = { src: 'https://signed.example/a.webm', failed: false, pending: false, attempt: 0 };
  // jsdom implements neither playback nor `paused`; model just enough of both.
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function play() {
    Object.defineProperty(this, 'paused', { configurable: true, value: false });
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function pause() {
    Object.defineProperty(this, 'paused', { configurable: true, value: true });
    this.dispatchEvent(new Event('pause'));
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('MV-008 voice notes share the playback arbitration', () => {
  it('pauses the first voice note when a second one starts', async () => {
    render(<><VoiceMessagePlayer src="voice/a.webm" /><VoiceMessagePlayer src="voice/b.webm" /></>);
    const [first, second] = screen.getAllByRole('button', { name: 'Play voice message' });

    fireEvent.click(first);
    await flush();
    expect(screen.getAllByRole('button', { name: 'Pause voice message' })).toHaveLength(1);

    fireEvent.click(second);
    await flush();
    const paused = screen.getAllByRole('button', { name: 'Play voice message' });
    expect(paused).toHaveLength(1);
    expect(paused[0]).toBe(first);
  });

  it('is paused when the viewer takes over', async () => {
    const { container } = render(<VoiceMessagePlayer src="voice/a.webm" />);
    fireEvent.click(screen.getByRole('button', { name: 'Play voice message' }));
    await flush();

    const viewerEl = document.createElement('video');
    const off = feedVideoRegistry.register('viewer-under-test', viewerEl, PLAYBACK_PRIORITY.VIEWER);
    act(() => { feedVideoRegistry.requestPlay('viewer-under-test'); });

    expect(container.querySelector('audio').paused).toBe(true);
    expect(screen.getByRole('button', { name: 'Play voice message' })).toBeTruthy();
    off();
  });

  it('does not start over a playing viewer video', async () => {
    const viewerEl = document.createElement('video');
    Object.defineProperty(viewerEl, 'paused', { configurable: true, value: false });
    const off = feedVideoRegistry.register('viewer-under-test', viewerEl, PLAYBACK_PRIORITY.VIEWER);
    feedVideoRegistry.requestPlay('viewer-under-test');
    render(<VoiceMessagePlayer src="voice/a.webm" />);

    fireEvent.click(screen.getByRole('button', { name: 'Play voice message' }));
    await flush();

    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    off();
  });

  it('plays the signed URL, not the raw key, and has nothing to play while signing', () => {
    signed.state = { src: '', failed: false, pending: true, attempt: 0 };
    const pending = render(<VoiceMessagePlayer src="voice/a.webm" />);
    expect(pending.container.querySelector('audio')).toBeNull();
    cleanup();

    signed.state = { src: 'https://signed.example/a.webm', failed: false, pending: false, attempt: 0 };
    const ready = render(<VoiceMessagePlayer src="voice/a.webm" />);
    expect(ready.container.querySelector('audio').getAttribute('src')).toBe('https://signed.example/a.webm');
  });

  it('re-signs once on a playback error before giving up', () => {
    const { container } = render(<VoiceMessagePlayer src="voice/a.webm" />);
    fireEvent.error(container.querySelector('audio'));
    expect(signed.refresh).toHaveBeenCalledTimes(1);
    expect(container.querySelector('audio')).not.toBeNull();

    fireEvent.error(container.querySelector('audio'));
    expect(signed.refresh).toHaveBeenCalledTimes(1);
    expect(container.querySelector('audio')).toBeNull();
  });
});

describe('chat video tile (MV-004, MV-009, MV-025)', () => {
  const KEY = 'https://api.example/api/media/chat/clip.mp4';

  it('shows a sized placeholder, never "unavailable", while the signature is pending', () => {
    signed.state = { src: '', failed: false, pending: true, attempt: 0 };
    const { container } = render(<VideoPlayerWithOverlay src={KEY} width={1080} height={1920} />);

    expect(screen.queryByText('Video unavailable')).toBeNull();
    const placeholder = screen.getByRole('status', { name: 'Loading video' });
    expect(placeholder.style.getPropertyValue('--aspect')).toBe(String(1080 / 1920));
    expect(container.querySelector('video')).toBeNull();
  });

  it('reports a refused signature as unavailable and offers a retry', () => {
    signed.state = { src: '', failed: true, pending: false, attempt: 0 };
    render(<VideoPlayerWithOverlay src={KEY} />);

    expect(screen.getByText('Video unavailable')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(signed.refresh).toHaveBeenCalledTimes(1);
  });

  it('opens the viewer with the stable source, never the signed URL', () => {
    const open = vi.fn();
    const extra = { report: { targetType: 'MESSAGE', targetId: 'm1' } };
    render(<VideoPlayerWithOverlay src={KEY} onOpenMediaModal={open} openExtra={extra} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open video' }));

    expect(open).toHaveBeenCalledWith(KEY, 'video', extra);
    expect(open.mock.calls[0][0]).not.toContain('signed.example');
  });

  it('opens from a captioned (inline) bubble too, instead of playing a silent preview', () => {
    const open = vi.fn();
    render(<VideoPlayerWithOverlay src={KEY} isInline hasText onOpenMediaModal={open} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open video' }));
    expect(open).toHaveBeenCalledOnce();
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  it('is not openable while the upload is unfinished', () => {
    render(<VideoPlayerWithOverlay src="blob:local" onOpenMediaModal={vi.fn()} openDisabled />);
    expect(screen.queryByRole('button', { name: 'Open video' })).toBeNull();
  });

  it('re-signs once on a playback error, then reports it', () => {
    const { container } = render(<VideoPlayerWithOverlay src={KEY} onOpenMediaModal={vi.fn()} />);
    fireEvent.error(container.querySelector('video'));
    expect(signed.refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Video unavailable')).toBeNull();

    fireEvent.error(container.querySelector('video'));
    expect(signed.refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Video unavailable')).toBeTruthy();
  });
});
