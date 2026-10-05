/** @vitest-environment jsdom */
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';

const signed = vi.hoisted(() => ({ source: { src: 'image.png', failed: false, pending: false }, refresh: vi.fn() }));
vi.mock('@shared/hooks/useSignedMediaSrc', () => ({
  useSignedMediaSrc: () => ({ ...signed.source, refresh: signed.refresh, attempt: 0 }),
}));
vi.mock('../VideoViewer', () => ({ default: () => <video /> }));

const { default: ImageViewer } = await import('../ImageViewer');

const pt = (x, y) => ({ clientX: x, clientY: y });
function fire(node, type, touches) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', { value: touches });
  Object.defineProperty(event, 'changedTouches', { value: touches });
  act(() => { node.dispatchEvent(event); });
  return event;
}
const tap = (node, x, y) => { fire(node, 'touchstart', [pt(x, y)]); return fire(node, 'touchend', []); };

let wrap;
let img;
let mediaRef;
let zoomApiRef;
let onToggle;

function mount(props = {}) {
  mediaRef = createRef();
  zoomApiRef = createRef();
  onToggle = vi.fn();
  const result = render(<ImageViewer src="image.png" mediaRef={mediaRef} zoomApiRef={zoomApiRef} onToggleControls={onToggle} {...props} />);
  wrap = result.container.firstChild;
  img = result.container.querySelector('img');
  return result;
}
/** Marks the image as loaded and measured, as the browser would. */
function loadImage() {
  Object.defineProperty(img, 'offsetWidth', { value: 400, configurable: true });
  Object.defineProperty(img, 'offsetHeight', { value: 300, configurable: true });
  Object.defineProperty(wrap, 'clientWidth', { value: 400, configurable: true });
  Object.defineProperty(wrap, 'clientHeight', { value: 600, configurable: true });
  act(() => { fireEvent.load(img); });
  act(() => vi.advanceTimersByTime(16));
}

beforeEach(() => {
  vi.useFakeTimers();
  signed.source = { src: 'image.png', failed: false, pending: false };
  vi.stubGlobal('requestAnimationFrame', (cb) => setTimeout(cb, 16));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('double-tap zoom (MV-001)', () => {
  it('zooms on two quick taps in the same place', () => {
    mount(); loadImage();
    tap(wrap, 200, 300);
    act(() => vi.advanceTimersByTime(100));
    const second = tap(wrap, 205, 302);
    expect(wrap.getAttribute('data-zoomed')).toBe('true');
    expect(img.style.transform).toContain('scale(2)');
    expect(second.defaultPrevented).toBe(true);
  });

  it('does not zoom when the first touch was a swipe', () => {
    mount(); loadImage();
    fire(wrap, 'touchstart', [pt(300, 300)]);
    fire(wrap, 'touchmove', [pt(100, 300)]);
    fire(wrap, 'touchend', []);
    act(() => vi.advanceTimersByTime(50));
    tap(wrap, 200, 300);
    expect(wrap.hasAttribute('data-zoomed')).toBe(false);
  });

  it('does not zoom when the second touch becomes a drag', () => {
    mount(); loadImage();
    tap(wrap, 200, 300);
    act(() => vi.advanceTimersByTime(50));
    fire(wrap, 'touchstart', [pt(200, 300)]);
    fire(wrap, 'touchmove', [pt(200, 380)]);
    fire(wrap, 'touchend', []);
    expect(wrap.hasAttribute('data-zoomed')).toBe(false);
  });

  it('does not treat taps far apart as a double-tap', () => {
    mount(); loadImage();
    tap(wrap, 50, 100);
    act(() => vi.advanceTimersByTime(80));
    tap(wrap, 350, 500);
    expect(wrap.hasAttribute('data-zoomed')).toBe(false);
  });

  it('does not treat slow taps as a double-tap', () => {
    mount(); loadImage();
    tap(wrap, 200, 300);
    act(() => vi.advanceTimersByTime(400));
    tap(wrap, 200, 300);
    expect(wrap.hasAttribute('data-zoomed')).toBe(false);
  });

  it('forgets a tap when the touch was cancelled', () => {
    mount(); loadImage();
    tap(wrap, 200, 300);
    fire(wrap, 'touchstart', [pt(200, 300)]);
    fire(wrap, 'touchcancel', []);
    act(() => vi.advanceTimersByTime(20));
    tap(wrap, 200, 300);
    expect(wrap.hasAttribute('data-zoomed')).toBe(false);
  });

  it('forgets a tap when a pinch intervenes', () => {
    mount(); loadImage();
    tap(wrap, 200, 300);
    fire(wrap, 'touchstart', [pt(100, 300), pt(300, 300)]);
    fire(wrap, 'touchend', [pt(300, 300)]);
    fire(wrap, 'touchend', []);
    act(() => vi.advanceTimersByTime(20));
    tap(wrap, 200, 300);
    expect(wrap.hasAttribute('data-zoomed')).toBe(false);
  });

  it('zooms back out on another double-tap', () => {
    mount(); loadImage();
    tap(wrap, 200, 300); act(() => vi.advanceTimersByTime(60)); tap(wrap, 200, 300);
    expect(wrap.getAttribute('data-zoomed')).toBe('true');
    act(() => vi.advanceTimersByTime(600));
    tap(wrap, 200, 300); act(() => vi.advanceTimersByTime(60)); tap(wrap, 200, 300);
    expect(wrap.hasAttribute('data-zoomed')).toBe(false);
  });
});

describe('tap to toggle controls (extra A)', () => {
  it('still toggles the controls on a plain click after a double-tap round trip', () => {
    mount(); loadImage();
    // zoom in, zoom out by double-tap
    tap(wrap, 200, 300); act(() => vi.advanceTimersByTime(60)); tap(wrap, 200, 300);
    act(() => vi.advanceTimersByTime(600));
    tap(wrap, 200, 300); act(() => vi.advanceTimersByTime(60)); tap(wrap, 200, 300);
    act(() => vi.advanceTimersByTime(600));
    onToggle.mockClear();

    fire(wrap, 'touchstart', [pt(200, 300)]);
    fire(wrap, 'touchend', []);
    fireEvent.click(wrap);
    expect(onToggle).toHaveBeenCalledOnce();
  });
});

describe('gesture target (MV-002)', () => {
  it('points at the wrapper, never the zoomed image', () => {
    mount(); loadImage();
    expect(mediaRef.current).toBe(wrap);
    expect(mediaRef.current).not.toBe(img);
  });

  it('follows the wrapper into the error card, so a failed image can be dragged', () => {
    const result = mount();
    fireEvent.error(img);
    expect(result.getByText('Media unavailable')).toBeTruthy();
    expect(mediaRef.current).toBe(wrap);
  });

  it('claims the target while only the skeleton is showing', () => {
    mount();
    expect(mediaRef.current).toBe(wrap);
  });

  it('does not write transforms on the image from the dismiss target', () => {
    mount(); loadImage();
    img.style.transform = 'translate3d(0px, 0px, 0) scale(2)';
    mediaRef.current.style.transform = 'translate3d(0, 120px, 0)';
    mediaRef.current.style.transform = '';
    expect(img.style.transform).toBe('translate3d(0px, 0px, 0) scale(2)');
  });

  it('releases the target when unmounted', () => {
    const result = mount();
    result.unmount();
    expect(mediaRef.current).toBeNull();
  });

  it('works with no mediaRef at all', () => {
    expect(() => render(<ImageViewer src="image.png" />)).not.toThrow();
  });
});

describe('keyboard zoom api (MV-035)', () => {
  it('zooms in and out about the centre and resets', () => {
    mount(); loadImage();
    const api = zoomApiRef.current;
    expect(api.isZoomed()).toBe(false);
    act(() => api.zoomIn());
    expect(api.isZoomed()).toBe(true);
    expect(img.style.transform).toContain('scale(1.5)');
    act(() => api.zoomIn());
    expect(img.style.transform).toContain('scale(2.25)');
    act(() => api.reset());
    expect(api.isZoomed()).toBe(false);
    expect(wrap.hasAttribute('data-zoomed')).toBe(false);
  });

  it('lands exactly on 1x when zooming out', () => {
    mount(); loadImage();
    const api = zoomApiRef.current;
    act(() => api.zoomIn());
    act(() => api.zoomOut());
    expect(api.isZoomed()).toBe(false);
    expect(img.style.transform).toContain('scale(1)');
  });

  it('caps zoom at the maximum', () => {
    mount(); loadImage();
    const api = zoomApiRef.current;
    for (let i = 0; i < 10; i += 1) act(() => api.zoomIn());
    expect(img.style.transform).toContain('scale(5)');
  });

  it('pans only while zoomed and reports when the edge stops it', () => {
    mount(); loadImage();
    const api = zoomApiRef.current;
    expect(api.panBy(-80, 0)).toBe(false);
    act(() => api.zoomIn());
    act(() => api.zoomIn());
    act(() => api.zoomIn());
    // 400px image at 3.375x = 1350px wide in a 400px viewport: plenty of room.
    expect(api.panBy(-80, 0)).toBe(true);
    for (let i = 0; i < 40; i += 1) api.panBy(-80, 0);
    expect(api.panBy(-80, 0)).toBe(false);
  });

  it('ignores zoom before the image has loaded', () => {
    mount();
    act(() => zoomApiRef.current.zoomIn());
    expect(zoomApiRef.current.isZoomed()).toBe(false);
  });

  it('releases the api when unmounted', () => {
    const result = mount();
    result.unmount();
    expect(zoomApiRef.current).toBeNull();
  });
});

describe('reduced motion (MV-037)', () => {
  it('applies zoom without a transition', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    mount(); loadImage();
    act(() => zoomApiRef.current.zoomIn());
    expect(img.style.transition).toBe('none');
  });

  it('animates zoom normally otherwise', () => {
    mount(); loadImage();
    act(() => zoomApiRef.current.zoomIn());
    expect(img.style.transition).toMatch(/transform 220ms/);
  });
});

describe('neighbour preload links (MV-030)', () => {
  it('no longer renders a preload <link>', () => {
    const result = render(<ImageViewer src="image.png" preloadNext="n.png" preloadPrev="p.png" />);
    expect(result.container.querySelector('link')).toBeNull();
  });
});
