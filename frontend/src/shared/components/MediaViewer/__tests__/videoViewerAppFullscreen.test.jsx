/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

// The installed app's build.
vi.mock('@config', async (importOriginal) => ({ ...(await importOriginal()), IS_MOBILE_BUILD: true }));
vi.mock('@shared/utils/MediaCacheManager', () => ({
  mediaCache: { getSyncUrl: (v) => v, getUrl: vi.fn(async (v) => v), invalidate: vi.fn() },
}));

const { setMediaFullscreenDriver } = await import('@shared/lib/mediaFullscreen');
const { default: VideoViewer } = await import('../VideoViewer');

let driver;

function open(props = {}, { width = 1920, height = 1080 } = {}) {
  const result = render(<VideoViewer src="https://cdn.example/v.mp4" isCurrent {...props} />);
  const video = result.container.querySelector('video');
  Object.defineProperty(video, 'duration', { configurable: true, get: () => 60 });
  Object.defineProperty(video, 'videoWidth', { configurable: true, get: () => width });
  Object.defineProperty(video, 'videoHeight', { configurable: true, get: () => height });
  act(() => { fireEvent(video, new Event('loadedmetadata')); fireEvent(video, new Event('canplay')); });
  return { ...result, video };
}

beforeEach(() => {
  driver = { enter: vi.fn(async () => true), exit: vi.fn(async () => {}) };
  setMediaFullscreenDriver(driver);
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  setMediaFullscreenDriver(null);
  vi.restoreAllMocks();
});

describe('fullscreen in the installed app', () => {
  it('asks the shell, turning the screen for a wide clip, and tells the viewer', async () => {
    const onFullscreenChange = vi.fn();
    const { container } = open({ onFullscreenChange });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Fullscreen' })); });
    expect(driver.enter).toHaveBeenCalledWith({ landscape: true });
    expect(container.querySelector('[data-fullscreen]')).not.toBeNull();
    expect(onFullscreenChange).toHaveBeenLastCalledWith(true);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Exit fullscreen' })); });
    expect(driver.exit).toHaveBeenCalledTimes(1);
    expect(onFullscreenChange).toHaveBeenLastCalledWith(false);
  });

  it('keeps a portrait clip upright', async () => {
    open({}, { width: 720, height: 1280 });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Fullscreen' })); });
    expect(driver.enter).toHaveBeenCalledWith({ landscape: false });
  });

  it('gives the window back when the viewer closes or the slide changes', async () => {
    const { rerender } = open();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Fullscreen' })); });
    rerender(<VideoViewer src="https://cdn.example/v.mp4" isCurrent={false} />);
    expect(driver.exit).toHaveBeenCalledTimes(1);
  });

  it('gives the window back on unmount', async () => {
    const { unmount } = open();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Fullscreen' })); });
    unmount();
    expect(driver.exit).toHaveBeenCalledTimes(1);
  });

  it('drops the fullscreen state if the shell refuses', async () => {
    driver.enter.mockResolvedValue(false);
    const { container } = open();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Fullscreen' })); });
    expect(container.querySelector('[data-fullscreen]')).toBeNull();
  });
});
