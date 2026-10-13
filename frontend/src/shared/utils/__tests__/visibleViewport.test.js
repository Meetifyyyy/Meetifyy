/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { keyboardInset, onVisibleViewportChange, visibleViewportBottom } from '../visibleViewport';

/**
 * The two ways a keyboard shows up, and the one the old `visualViewport.height`
 * measurement missed: in the Android app the keyboard overlays the page and
 * leaves both viewports at full height, so `--kb-inset` is the only record.
 */
describe('visibleViewport', () => {
  const root = document.documentElement;
  let vv;

  beforeEach(() => {
    vi.stubGlobal('innerHeight', 800);
    vv = Object.assign(new EventTarget(), { height: 800, offsetTop: 0 });
    vi.stubGlobal('visualViewport', vv);
  });

  afterEach(() => {
    root.style.removeProperty('--kb-inset');
    vi.unstubAllGlobals();
  });

  it('is the full layout viewport with no keyboard', () => {
    expect(keyboardInset()).toBe(0);
    expect(visibleViewportBottom()).toBe(800);
  });

  it('ends at the keyboard when it overlays the page and no viewport shrank (Android app)', () => {
    root.style.setProperty('--kb-inset', '320px');
    expect(keyboardInset()).toBe(320);
    expect(visibleViewportBottom()).toBe(480);
  });

  it('does not subtract the keyboard twice where the visual viewport shrinks too (iOS, website)', () => {
    vv.height = 480;
    root.style.setProperty('--kb-inset', '320px');
    expect(visibleViewportBottom()).toBe(480);
  });

  it('follows a visual viewport that shrank or scrolled with no inset published', () => {
    vv.height = 500;
    vv.offsetTop = 40;
    expect(visibleViewportBottom()).toBe(540);
  });

  it('ignores a malformed or negative inset', () => {
    root.style.setProperty('--kb-inset', 'calc(1px)');
    expect(keyboardInset()).toBe(0);
    root.style.setProperty('--kb-inset', '-12px');
    expect(keyboardInset()).toBe(0);
  });

  it('reports a keyboard transition, which resizes nothing, one frame later', () => {
    const frames = [];
    vi.stubGlobal('requestAnimationFrame', (cb) => { frames.push(cb); return frames.length; });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const onChange = vi.fn();
    const stop = onVisibleViewportChange(onChange);

    window.dispatchEvent(new CustomEvent('meetifyy:ime', { detail: { visible: true, height: 320, duration: 250 } }));
    // Coalesced: a resize in the same frame does not schedule a second call.
    vv.dispatchEvent(new Event('resize'));
    expect(onChange).not.toHaveBeenCalled();
    expect(frames).toHaveLength(1);
    frames.shift()();
    expect(onChange).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event('meetifyy:keyboard-hidden'));
    frames.shift()();
    expect(onChange).toHaveBeenCalledTimes(2);

    stop();
    window.dispatchEvent(new CustomEvent('meetifyy:ime', { detail: { visible: false, height: 0, duration: 250 } }));
    expect(frames).toHaveLength(0);
  });
});
