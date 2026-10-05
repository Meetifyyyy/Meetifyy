/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const viewer = vi.hoisted(() => ({
  state: null, close: vi.fn(), navigate: vi.fn(), menuClose: vi.fn(), 
  zoom: null,
}));
vi.mock('@shared/context/MediaViewerContext', () => ({
  useMediaViewer: () => ({ state: viewer.state, closeViewer: viewer.close, navigate: viewer.navigate }),
}));
vi.mock('@shared/hooks/useOverlayBack', () => ({ useOverlayBack: () => {} }));
vi.mock('@shared/hooks/useScrollLock', () => ({ useScrollLock: () => {} }));
vi.mock('@shared/components/ui/Menu', () => ({
  default: ({ children }) => <div>{children}</div>, MenuItem: ({ children, onSelect }) => <button onClick={onSelect}>{children}</button>,
  useMenu: () => ({ close: viewer.menuClose, triggerProps: {}, menuProps: {} }),
}));
// The mock claims the gesture target and the zoom API the way the real viewer does.
vi.mock('../ImageViewer', () => ({
  default: ({ mediaRef, zoomApiRef }) => {
    if (zoomApiRef) zoomApiRef.current = viewer.zoom;
    return <div data-testid="media" ref={(el) => { if (mediaRef && el) mediaRef.current = el; }} />;
  },
}));
vi.mock('../VideoViewer', () => ({ default: () => <video /> }));
vi.mock('@shared/components/modals/ReportModal/LazyReportModal', () => ({ default: () => null }));
vi.mock('@features/messages/shared/components/modals/ForwardMessageModal', () => ({ default: () => null }));
vi.mock('@shared/hooks/useRecipientConversations', () => ({ useRecipientConversations: () => ({ conversations: [] }) }));
vi.mock('@shared/hooks/useMessageActions', () => ({ useMessageActions: () => ({}) }));
vi.mock('@shared/utils/feedVideoRegistry', () => ({ feedVideoRegistry: { pauseAll: vi.fn() } }));
vi.mock('@shared/lib/share/shareTargets', () => ({ copyToClipboard: vi.fn(), shareNatively: vi.fn() }));
vi.mock('@shared/utils/MediaCacheManager', () => ({ mediaCache: { getUrl: vi.fn() } }));
vi.mock('@shared/utils/toast', () => ({ showToast: vi.fn() }));

const { default: MediaViewer } = await import('../MediaViewer');

const touch = (x, y) => ({ clientX: x, clientY: y });
/** Dispatches a native touch event with the given active touches. */
function fire(node, type, touches) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', { value: touches });
  Object.defineProperty(event, 'changedTouches', { value: touches });
  act(() => { node.dispatchEvent(event); });
  return event;
}
const frame = () => act(() => vi.advanceTimersByTime(16));

let stage;
let track;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  viewer.zoom = null;
  
  viewer.state = {
    open: true,
    items: [{ url: 'a.png', type: 'image' }, { url: 'b.png', type: 'image' }, { url: 'c.png', type: 'image' }],
    index: 1,
    meta: { source: 'Post' },
  };
  vi.stubGlobal('requestAnimationFrame', (cb) => setTimeout(cb, 16));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  render(<MediaViewer />);
  act(() => vi.advanceTimersByTime(16));
  const slide = screen.getByRole('dialog').querySelector('[data-slide-index]');
  track = slide.parentElement;
  stage = track.parentElement;
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const media = () => screen.getAllByTestId('media').find((el) => el.closest('[data-slide-index="1"]'));

describe('swipe and dismiss gestures', () => {
  it('still pages on a completed swipe', () => {
    fire(stage, 'touchstart', [touch(500, 300)]);
    fire(stage, 'touchmove', [touch(100, 305)]);
    frame();
    fire(stage, 'touchend', []);
    expect(viewer.navigate).toHaveBeenCalledWith(1);
  });

  it('does not page or close when the OS cancels a swipe past the threshold', () => {
    fire(stage, 'touchstart', [touch(500, 300)]);
    fire(stage, 'touchmove', [touch(60, 300)]);
    frame();
    fire(stage, 'touchcancel', []);
    expect(viewer.navigate).not.toHaveBeenCalled();
    // The track went back to the current slide rather than staying mid-drag.
    expect(track.style.transform).toBe('translate3d(-100%, 0, 0)');
  });

  it('does not close when the OS cancels a dismiss drag past the threshold', () => {
    fire(stage, 'touchstart', [touch(300, 100)]);
    fire(stage, 'touchmove', [touch(300, 900)]);
    frame();
    fire(stage, 'touchcancel', []);
    act(() => vi.advanceTimersByTime(400));
    expect(viewer.close).not.toHaveBeenCalled();
    expect(media().style.transform).toBe('');
  });

  it('drops a one-finger gesture when a second finger joins (pinch handoff)', () => {
    fire(stage, 'touchstart', [touch(500, 300)]);
    fire(stage, 'touchmove', [touch(100, 300)]);
    frame();
    fire(stage, 'touchstart', [touch(100, 300), touch(200, 300)]);
    fire(stage, 'touchend', [touch(200, 300)]);
    fire(stage, 'touchend', []);
    expect(viewer.navigate).not.toHaveBeenCalled();
    expect(viewer.close).not.toHaveBeenCalled();
  });

  it('does not decide anything when one finger lifts while another is down', () => {
    fire(stage, 'touchstart', [touch(500, 300)]);
    fire(stage, 'touchmove', [touch(60, 300)]);
    frame();
    fire(stage, 'touchend', [touch(900, 300)]);
    fire(stage, 'touchend', []);
    expect(viewer.navigate).not.toHaveBeenCalled();
  });

  it('leaves the media transform alone on a plain tap', () => {
    media().style.transform = 'translate3d(0px, 0px, 0) scale(2)';
    fire(stage, 'touchstart', [touch(300, 300)]);
    fire(stage, 'touchend', []);
    expect(media().style.transform).toBe('translate3d(0px, 0px, 0) scale(2)');
  });

  it('dismisses on a long vertical drag', () => {
    fire(stage, 'touchstart', [touch(300, 100)]);
    fire(stage, 'touchmove', [touch(300, 900)]);
    frame();
    fire(stage, 'touchend', []);
    act(() => vi.advanceTimersByTime(280));
    expect(viewer.close).toHaveBeenCalledTimes(1);
  });
});

describe('snap-back cleanup', () => {
  it('does not erase a drag that began while the previous snap-back settled', () => {
    fire(stage, 'touchstart', [touch(300, 300)]);
    fire(stage, 'touchmove', [touch(300, 340)]);
    frame();
    fire(stage, 'touchend', []);                 // short: snaps back, cleanup due at +340ms
    act(() => vi.advanceTimersByTime(100));

    fire(stage, 'touchstart', [touch(300, 300)]);
    fire(stage, 'touchmove', [touch(300, 380)]);
    frame();
    const dragging = media().style.transform;
    expect(dragging).toMatch(/translate3d\(0, [\d.]+px, 0\)/);

    act(() => vi.advanceTimersByTime(300));      // the old cleanup's deadline passes
    expect(media().style.transform).toBe(dragging);
  });

  it('does not erase the dismiss fly-out', () => {
    fire(stage, 'touchstart', [touch(300, 300)]);
    fire(stage, 'touchmove', [touch(300, 340)]);
    frame();
    fire(stage, 'touchend', []);
    act(() => vi.advanceTimersByTime(100));

    fire(stage, 'touchstart', [touch(300, 100)]);
    fire(stage, 'touchmove', [touch(300, 900)]);
    frame();
    fire(stage, 'touchend', []);
    const flying = media().style.transform;
    act(() => vi.advanceTimersByTime(300));
    expect(media().style.transform).toBe(flying);
  });

  it('clears the inline styles once the transition has run', () => {
    fire(stage, 'touchstart', [touch(300, 300)]);
    fire(stage, 'touchmove', [touch(300, 340)]);
    frame();
    fire(stage, 'touchend', []);
    expect(media().style.transition).toMatch(/transform/);
    act(() => vi.advanceTimersByTime(340));
    expect(media().style.transition).toBe('');
  });
});

describe('reduced motion', () => {
  it('lands the snap-back instantly instead of animating it', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    fire(stage, 'touchstart', [touch(500, 300)]);
    fire(stage, 'touchmove', [touch(480, 300)]);
    frame();
    fire(stage, 'touchend', []);
    expect(track.style.transition).toBe('none');
  });
});

describe('keyboard zoom and pan', () => {
  const press = (key, init = {}) => fireEvent.keyDown(screen.getByRole('dialog'), { key, ...init });

  beforeEach(() => {
    viewer.zoom = {
      zoomIn: vi.fn(), zoomOut: vi.fn(), reset: vi.fn(), panBy: vi.fn(() => true), isZoomed: vi.fn(() => false),
    };
    cleanup();
    render(<MediaViewer />);
    act(() => vi.advanceTimersByTime(16));
  });

  it('zooms and resets with + - 0', () => {
    press('+'); press('='); press('-'); press('0');
    expect(viewer.zoom.zoomIn).toHaveBeenCalledTimes(2);
    expect(viewer.zoom.zoomOut).toHaveBeenCalledTimes(1);
    expect(viewer.zoom.reset).toHaveBeenCalledTimes(1);
  });

  it('keeps the arrows paging the gallery at 1x', () => {
    press('ArrowRight'); press('ArrowLeft');
    expect(viewer.navigate).toHaveBeenNthCalledWith(1, 1);
    expect(viewer.navigate).toHaveBeenNthCalledWith(2, -1);
    expect(viewer.zoom.panBy).not.toHaveBeenCalled();
  });

  it('pans with the arrows while zoomed instead of paging', () => {
    viewer.zoom.isZoomed.mockReturnValue(true);
    press('ArrowLeft'); press('ArrowDown');
    expect(viewer.zoom.panBy).toHaveBeenCalledWith(80, 0);
    expect(viewer.zoom.panBy).toHaveBeenCalledWith(0, -80);
    expect(viewer.navigate).not.toHaveBeenCalled();
  });

  it('pages again once a zoomed image is against the edge', () => {
    viewer.zoom.isZoomed.mockReturnValue(true);
    viewer.zoom.panBy.mockReturnValue(false);
    press('ArrowRight');
    expect(viewer.navigate).toHaveBeenCalledWith(1);
  });

  it('exposes visible zoom controls wired to the same actions', () => {
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fit to screen' }));
    expect(viewer.zoom.zoomIn).toHaveBeenCalledOnce();
    expect(viewer.zoom.zoomOut).toHaveBeenCalledOnce();
    expect(viewer.zoom.reset).toHaveBeenCalledOnce();
  });

  it('ignores modified shortcuts so browser zoom keeps working', () => {
    press('+', { ctrlKey: true });
    expect(viewer.zoom.zoomIn).not.toHaveBeenCalled();
  });
});
