/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const viewer = vi.hoisted(() => ({
  getUrl: vi.fn(), state: null, close: vi.fn(), navigate: vi.fn(), menuClose: vi.fn(), 
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
vi.mock('../ImageViewer', () => ({ default: () => <img alt="Test media" /> }));
vi.mock('../VideoViewer', () => ({ default: () => <video /> }));
vi.mock('@shared/components/modals/ReportModal/LazyReportModal', () => ({ default: () => null }));
vi.mock('@features/messages/shared/components/modals/ForwardMessageModal', () => ({ default: () => null }));
vi.mock('@shared/hooks/useRecipientConversations', () => ({ useRecipientConversations: () => ({ conversations: [] }) }));
vi.mock('@shared/hooks/useMessageActions', () => ({ useMessageActions: () => ({}) }));
vi.mock('@shared/utils/feedVideoRegistry', () => ({ feedVideoRegistry: { pauseAll: vi.fn() } }));
vi.mock('@shared/lib/share/shareTargets', () => ({ copyToClipboard: vi.fn(), shareNatively: vi.fn() }));
vi.mock('@shared/utils/MediaCacheManager', () => ({ mediaCache: { getUrl: viewer.getUrl } }));
vi.mock('@shared/utils/toast', () => ({ showToast: vi.fn() }));

const { default: MediaViewer } = await import('../MediaViewer');
let pause;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  viewer.getUrl.mockResolvedValue('https://media.example/file?signature=valid');
  viewer.state = { open: true, items: [{ url: 'image.png', type: 'image' }], index: 0, meta: { source: 'Post' } };
  vi.stubGlobal('requestAnimationFrame', callback => setTimeout(callback, 16));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const open = () => { const result = render(<MediaViewer />); act(() => vi.advanceTimersByTime(16)); return result; };

describe('media viewer close lifecycle', () => {
  it('hides chrome immediately and closes only once after the media exit', () => {
    open();
    const dialog = screen.getByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(dialog.className).toMatch(/closing/);
    expect(dialog.hasAttribute('inert')).toBe(true);
    expect(viewer.menuClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    act(() => vi.advanceTimersByTime(279));
    expect(viewer.close).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(viewer.close).toHaveBeenCalledTimes(1);
  });

  it('does not offer an unsupported owner Delete action', () => {
    viewer.state.meta.isOwner = true;
    open();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('downloads the authorized URL without changing its signature', async () => {
    viewer.state.items = [{ url: '/api/media/chat/private.png', type: 'image' }];
    const fetcher = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['test'], { type: 'image/png' }) });
    vi.stubGlobal('fetch', fetcher);
    const originalCreate = URL.createObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:test');
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    open();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Download' })));
    expect(viewer.getUrl).toHaveBeenCalledWith('/api/media/chat/private.png');
    expect(fetcher).toHaveBeenCalledWith('https://media.example/file?signature=valid', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(click).toHaveBeenCalledOnce();
    URL.createObjectURL = originalCreate;
  });

  it('pauses video at the start of closing', () => {
    viewer.state.items = [{ url: 'video.mp4', type: 'video' }];
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(pause).toHaveBeenCalledTimes(1);
    expect(viewer.close).not.toHaveBeenCalled();
  });

  it('cancels a stale close when new media opens during the exit', () => {
    const result = open();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    viewer.state = { ...viewer.state, items: [{ url: 'new.png', type: 'image' }] };
    result.rerender(<MediaViewer />);
    act(() => vi.advanceTimersByTime(300));
    expect(viewer.close).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog').hasAttribute('inert')).toBe(false);
  });

  it('clears the close timer on unmount', () => {
    const result = open();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    result.unmount();
    act(() => vi.advanceTimersByTime(300));
    expect(viewer.close).not.toHaveBeenCalled();
  });

  it('does not retain the animation delay in reduced-motion mode', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    act(() => vi.advanceTimersByTime(0));
    expect(viewer.close).toHaveBeenCalledTimes(1);
  });

  describe('the page behind the viewer', () => {
    it('is never scrolled by the viewer, on close or afterwards', () => {
      // It used to scroll the opener back into view when focus returned, then
      // jump the page back with a delayed scrollTo: two visible jumps.
      const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
      const result = open();
      viewer.state = { ...viewer.state, open: false };
      result.rerender(<MediaViewer />);
      act(() => vi.advanceTimersByTime(1000));
      expect(scrollTo).not.toHaveBeenCalled();
    });
  });
});
