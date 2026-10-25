/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import VideoViewer from '../VideoViewer';

/*
 * Conversation media needs signing; anything else is used as it is. The signed
 * URL changes on every request, as a real re-sign does.
 */
let signCount = 0;
vi.mock('@shared/utils/MediaCacheManager', () => ({
  mediaCache: {
    getSyncUrl: (v) => (v.startsWith('/api/media/') ? '' : v),
    getUrl: vi.fn(async (v) => (v.startsWith('/api/media/') ? `https://signed.example${v}?sig=${++signCount}` : v)),
    invalidate: vi.fn(),
  },
}));

const PUBLIC = 'https://cdn.example/v.mp4';

let play;

/** Gives a jsdom <video> the media state and layout it does not implement. */
function drive(video, { duration = 100, paused = true, time = 0 } = {}) {
  const s = { time, paused, duration };
  Object.defineProperty(video, 'duration', { configurable: true, get: () => s.duration });
  Object.defineProperty(video, 'currentTime', { configurable: true, get: () => s.time, set: (n) => { s.time = n; } });
  Object.defineProperty(video, 'paused', { configurable: true, get: () => s.paused });
  video.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 600, right: 1000, bottom: 600 });
  return s;
}

const fire = (el, type) => fireEvent(el, new Event(type));

/** Decides what `:focus-visible` reports: true for keyboard focus, false for a pointer's. */
function focusVisible(value) {
  const matches = Element.prototype.matches;
  vi.spyOn(Element.prototype, 'matches').mockImplementation(function (sel) {
    return sel === ':focus-visible' ? value : matches.call(this, sel);
  });
}
const overlay = (container) => container.querySelector('[data-controls][class*="videoControlsOverlay"]');
const controlsShown = (container) => overlay(container)?.getAttribute('aria-hidden') === 'false';

/** A loaded, playing video with its controls up. */
function openPlaying(props = {}, wrap) {
  const ui = <VideoViewer src={PUBLIC} isCurrent {...props} />;
  const result = render(wrap ? wrap(ui) : ui);
  const video = result.container.querySelector('video');
  const state = drive(video, { time: 50 });
  act(() => {
    fire(video, 'loadedmetadata');
    fire(video, 'canplay');
    state.paused = false;
    fire(video, 'play');
  });
  return { ...result, video, state };
}

/** A tap the way a phone delivers it: touches, then the compatibility mouse events. */
function tap(target, wrapEl, x) {
  const point = { clientX: x, clientY: 300 };
  fireEvent.touchStart(target, { touches: [point], changedTouches: [point] });
  fireEvent.touchEnd(target, { touches: [], changedTouches: [point] });
  fireEvent.mouseMove(wrapEl, point);
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  signCount = 0;
  play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.stubGlobal('requestAnimationFrame', (cb) => setTimeout(() => cb(Date.now()), 0));
  vi.stubGlobal('cancelAnimationFrame', (id) => clearTimeout(id));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('controls auto-hide', () => {
  it('still hides after a control was pressed with a pointer', () => {
    const { container } = openPlaying();
    const seek = screen.getByRole('slider', { name: 'Seek' });
    // A pointer press focuses the control, but that focus is not "visible".
    focusVisible(false);
    act(() => { seek.focus(); fire(container.querySelector('video'), 'playing'); });
    act(() => { vi.advanceTimersByTime(3100); });
    expect(controlsShown(container)).toBe(false);
  });

  it('stays up while keyboard focus is in the controls', () => {
    const { container } = openPlaying();
    const seek = screen.getByRole('slider', { name: 'Seek' });
    focusVisible(true);
    act(() => { seek.focus(); fire(container.querySelector('video'), 'playing'); });
    act(() => { vi.advanceTimersByTime(3100); });
    expect(controlsShown(container)).toBe(true);
  });
});

describe('touch gestures', () => {
  it('a tap on the side brings hidden controls back, despite the mousemove that follows it', () => {
    const { container, video } = openPlaying();
    act(() => { vi.advanceTimersByTime(3100); });
    expect(controlsShown(container)).toBe(false);

    const wrapEl = video.parentElement;
    act(() => { tap(video, wrapEl, 100); });
    act(() => { vi.advanceTimersByTime(400); });
    expect(controlsShown(container)).toBe(true);
  });

  it('keeps seeking on every further tap of a run on the same side', () => {
    const { video, state } = openPlaying();
    const wrapEl = video.parentElement;
    act(() => { tap(video, wrapEl, 100); });
    act(() => { vi.advanceTimersByTime(120); tap(video, wrapEl, 100); });
    expect(state.time).toBe(40);
    act(() => { vi.advanceTimersByTime(250); tap(video, wrapEl, 100); });
    act(() => { vi.advanceTimersByTime(250); tap(video, wrapEl, 100); });
    expect(state.time).toBe(20);
    // The ripple counts the whole run.
    act(() => { vi.advanceTimersByTime(20); });
    expect(screen.getByText('-30s')).toBeTruthy();
  });

  it('does not restart the play/pause flash when the player re-renders under it', () => {
    const { container, video, state } = openPlaying();
    state.paused = true;
    act(() => { fire(video, 'pause'); });
    const wrapEl = video.parentElement;
    act(() => { tap(video, wrapEl, 500); });
    act(() => { vi.advanceTimersByTime(320); });
    const flash = container.querySelector('[class*="tapFeedback"]');
    expect(flash).not.toBeNull();
    // Any re-render will do; a speed change is one the player always paints.
    act(() => { vi.advanceTimersByTime(20); video.playbackRate = 2; fire(video, 'ratechange'); });
    expect(container.querySelector('[class*="tapFeedback"]')).toBe(flash);
  });
});

describe('keyboard', () => {
  const inDialog = (ui) => <div role="dialog" aria-modal="true">{ui}</div>;

  it('answers Space when focus has fallen to <body>', () => {
    openPlaying({}, inDialog);
    play.mockClear();
    const before = HTMLMediaElement.prototype.pause.mock.calls.length;
    act(() => { fireEvent.keyDown(document.body, { key: ' ' }); });
    expect(HTMLMediaElement.prototype.pause.mock.calls.length).toBeGreaterThan(before);
  });

  it('leaves browser shortcuts alone', () => {
    const { video, state } = openPlaying({}, inDialog);
    act(() => { fireEvent.keyDown(video, { key: 'l', ctrlKey: true }); });
    act(() => { fireEvent.keyDown(video, { key: 'L', metaKey: true }); });
    expect(state.time).toBe(50);
    // The same keys without a modifier are still the player's.
    act(() => { fireEvent.keyDown(video, { key: 'l' }); });
    expect(state.time).toBe(60);
  });
});

describe('fullscreen', () => {
  it('offers no fullscreen button where the platform cannot enter it', () => {
    openPlaying();
    expect(screen.queryByRole('button', { name: 'Fullscreen' })).toBeNull();
  });

  it('offers it where element fullscreen exists', () => {
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
    try {
      openPlaying();
      expect(screen.getByRole('button', { name: 'Fullscreen' })).toBeTruthy();
    } finally {
      delete document.fullscreenEnabled;
    }
  });
});

describe('re-signing', () => {
  it('picks up where it stopped when an expired signature is replaced', async () => {
    const { container } = render(<VideoViewer src="/api/media/chat/a.mp4" isCurrent />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const first = container.querySelector('video');
    expect(first.getAttribute('src')).toContain('sig=1');
    const s1 = drive(first, { time: 0 });
    act(() => { fire(first, 'loadedmetadata'); });
    s1.time = 42;

    act(() => { fire(first, 'error'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const second = container.querySelector('video');
    expect(second).not.toBe(first);
    expect(second.getAttribute('src')).toContain('sig=2');
    const s2 = drive(second, { time: 0 });
    act(() => { fire(second, 'loadedmetadata'); });
    expect(s2.time).toBe(42);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
