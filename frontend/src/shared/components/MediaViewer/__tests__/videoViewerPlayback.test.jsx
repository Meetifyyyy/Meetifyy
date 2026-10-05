/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import VideoViewer from '../VideoViewer';
import { feedVideoRegistry } from '@shared/utils/feedVideoRegistry';

/*
 * The REAL useSignedMediaSrc and the REAL registry are used here on purpose:
 * the defects under test (a retry that restarts nothing, a seek that rebuilds
 * the element's listeners) live in how those pieces interact, which a mock of
 * either would hide.
 */
vi.mock('@shared/utils/MediaCacheManager', () => ({
  mediaCache: {
    getSyncUrl: (v) => v,
    getUrl: vi.fn(async (v) => v),
    invalidate: vi.fn(),
  },
}));

const PUBLIC = 'https://cdn.example/v.mp4';
const VOLUME_KEY = '__mv_volume__';

let play;
let rafs;

/** Gives a jsdom <video> the media state it does not implement. */
function drive(video, { duration = 100, paused = true } = {}) {
  const s = { time: 0, paused, duration };
  Object.defineProperty(video, 'duration', { configurable: true, get: () => s.duration });
  Object.defineProperty(video, 'currentTime', { configurable: true, get: () => s.time, set: (n) => { s.time = n; } });
  Object.defineProperty(video, 'paused', { configurable: true, get: () => s.paused });
  return s;
}

const fire = (el, type) => fireEvent(el, new Event(type));
const slider = () => screen.getByRole('slider', { name: 'Seek' });

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  rafs = new Map();
  let next = 0;
  vi.stubGlobal('requestAnimationFrame', (cb) => { rafs.set(++next, cb); return next; });
  vi.stubGlobal('cancelAnimationFrame', (id) => { rafs.delete(id); });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function open(props = {}) {
  const result = render(<VideoViewer src={PUBLIC} isCurrent {...props} />);
  const video = result.container.querySelector('video');
  const state = drive(video);
  return { ...result, video, state };
}

describe('MV-003 retry restarts an unchanged source', () => {
  it('mounts a fresh element for the same URL and plays it again', () => {
    const { container, video } = open();
    expect(play).toHaveBeenCalledTimes(1);

    fire(video, 'error');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    const next = container.querySelector('video');
    expect(next).not.toBe(video);
    expect(next.getAttribute('src')).toBe(PUBLIC);
    expect(play).toHaveBeenCalledTimes(2);
    // Back on the loading surface, not on a stale error card or frozen frame.
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('MV-005 seeking does not tear the player down', () => {
  it('keeps the progress loop, the registry entry and the audio settings through a drag', () => {
    const register = vi.spyOn(feedVideoRegistry, 'register');
    const { video, state } = open();
    state.duration = 100;
    fire(video, 'loadedmetadata');
    state.paused = false;
    fire(video, 'play');
    expect(rafs.size).toBe(1);
    expect(register).toHaveBeenCalledTimes(1);

    video.muted = true;
    video.volume = 0.3;
    slider().getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, height: 4, right: 100, bottom: 4 });
    fireEvent.mouseDown(slider(), { clientX: 40 });
    expect(state.time).toBe(40);
    fireEvent.mouseUp(document);

    expect(register).toHaveBeenCalledTimes(1);
    expect(video.muted).toBe(true);
    expect(video.volume).toBeCloseTo(0.3);
    // A frame callback is still scheduled, and running it repaints the clock.
    expect(rafs.size).toBe(1);
    state.time = 65;
    const [[, tick]] = [...rafs];
    act(() => tick());
    expect(screen.getByText('1:05')).toBeTruthy();
  });

  it('ends a drag the system cancelled instead of seeking on later touches', () => {
    const { video, state } = open();
    fire(video, 'loadedmetadata');
    slider().getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, height: 4, right: 100, bottom: 4 });

    fireEvent.touchStart(slider(), { touches: [{ clientX: 10 }] });
    expect(state.time).toBe(10);
    fireEvent.touchCancel(document);
    fireEvent.touchMove(document, { touches: [{ clientX: 90 }] });

    expect(state.time).toBe(10);
  });
});

describe('MV-006 metadata is not a decoded frame', () => {
  it('keeps the picture hidden until a frame exists, while the controls are usable', () => {
    const { video } = open();
    expect(screen.queryByRole('slider')).toBeNull();

    fire(video, 'loadedmetadata');
    expect(slider()).toBeTruthy();
    expect(video.style.visibility).toBe('hidden');

    fire(video, 'loadeddata');
    expect(video.style.visibility).toBe('visible');
  });
});

describe('MV-007 saved volume', () => {
  it('restores a saved zero instead of full volume', () => {
    localStorage.setItem(VOLUME_KEY, '0');
    const { video } = open();
    expect(video.volume).toBe(0);
  });

  it('falls back to full volume for junk and clamps out-of-range values', () => {
    localStorage.setItem(VOLUME_KEY, 'loud');
    expect(open().video.volume).toBe(1);
    cleanup();
    localStorage.setItem(VOLUME_KEY, '7');
    expect(() => open()).not.toThrow();
    expect(open().video.volume).toBe(1);
  });
});

describe('MV-036 seek slider', () => {
  it('answers to Home, End and Page keys and speaks the position as time', () => {
    const { video, state } = open();
    fire(video, 'loadedmetadata');
    expect(slider().getAttribute('aria-valuemax')).toBe('100');

    fireEvent.keyDown(slider(), { key: 'End' });
    expect(state.time).toBe(100);
    expect(slider().getAttribute('aria-valuenow')).toBe('100');
    expect(slider().getAttribute('aria-valuetext')).toBe('1:40 of 1:40');

    fireEvent.keyDown(slider(), { key: 'Home' });
    expect(state.time).toBe(0);
    fireEvent.keyDown(slider(), { key: 'PageUp' });
    expect(state.time).toBe(10);
    fireEvent.keyDown(slider(), { key: 'ArrowDown' });
    expect(state.time).toBe(5);
    expect(slider().getAttribute('aria-valuetext')).toBe('0:05 of 1:40');
  });
});
