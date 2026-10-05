/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  state: null,
  getUrl: vi.fn(),
  pauseAll: vi.fn(),
  send: vi.fn(),
  report: null,
  forward: null,
  video: null,
  image: null,
  clear: null,
}));

vi.mock('@shared/context/MediaViewerContext', () => ({
  useMediaViewer: () => ({
    state: h.state, closeViewer: vi.fn(), navigate: vi.fn(), 
  }),
}));
vi.mock('@shared/hooks/useOverlayBack', () => ({ useOverlayBack: () => {} }));
vi.mock('@shared/hooks/useScrollLock', () => ({ useScrollLock: () => {} }));
vi.mock('@shared/components/ui/Menu', () => ({
  default: ({ children }) => <div>{children}</div>,
  MenuItem: ({ children, onSelect, disabled }) => <button disabled={disabled} onClick={onSelect}>{children}</button>,
  useMenu: () => ({ close: () => {}, triggerProps: {}, menuProps: {} }),
}));
vi.mock('../ImageViewer', () => ({
  default: (props) => { h.image = props; return <img alt={props.label} />; },
}));
vi.mock('../VideoViewer', () => ({
  default: (props) => { h.video = props; return <video />; },
}));
vi.mock('@shared/components/modals/ReportModal/ReportModal', () => ({
  default: (props) => { h.report = props; return props.isOpen ? <div data-testid="report-open" /> : null; },
}));
vi.mock('@features/messages/shared/components/modals/ForwardMessageModal', () => ({
  default: (props) => { h.forward = props; return <div data-testid="forward-open" />; },
}));
vi.mock('@shared/hooks/useRecipientConversations', () => ({ useRecipientConversations: () => ({ conversations: [] }) }));
vi.mock('@shared/hooks/useMessageActions', () => ({ useMessageActions: () => ({ sendDirectMessage: h.send }) }));
vi.mock('@shared/utils/feedVideoRegistry', () => ({ feedVideoRegistry: { pauseAll: h.pauseAll } }));
vi.mock('@shared/lib/share/shareTargets', () => ({ copyToClipboard: vi.fn(), shareNatively: vi.fn() }));
vi.mock('@shared/utils/MediaCacheManager', () => ({ mediaCache: { getUrl: h.getUrl } }));
vi.mock('@shared/utils/toast', () => ({ showToast: vi.fn() }));

const { default: MediaViewer } = await import('../MediaViewer');
const { ForwardPartialError } = await import('@features/messages/shared/utils/forwardDelivery');
const { clearReportedTargets } = await import('@shared/utils/reportedTargets');

const IMG = (extra = {}) => ({ url: 'https://api.test/api/media/chat/a.png', rawUrl: '/api/media/chat/a.png', type: 'image', slideKey: '0:a', ...extra });

function setState(patch = {}) {
  h.state = { open: true, items: [IMG()], index: 0, meta: {}, sessionId: 1, ...patch };
}

beforeEach(() => {
  vi.clearAllMocks();
  clearReportedTargets();
  h.report = null; h.forward = null; h.video = null; h.image = null;
  setState();
  h.getUrl.mockResolvedValue('https://media.example/file.png?sig=ok');
  h.send.mockResolvedValue({});
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const reportBtn = () => screen.queryByRole('button', { name: /^(Report|Already reported)$/ });

describe('report target (MV-010)', () => {
  it('offers no Report when the opener named no target - no guessing from author or URL', () => {
    setState({ meta: { author: { id: 'u1', username: 'x' }, post: { id: 'p1', text: 'hi' } } });
    render(<MediaViewer />);
    expect(reportBtn()).toBeNull();
    expect(h.report).toBeNull();
  });

  it('uses meta.report by default and the item\'s own report over it', () => {
    setState({
      meta: { report: { targetType: 'POST', targetId: 'p1' } },
      items: [IMG(), IMG({ slideKey: '1:b', report: { targetType: 'MESSAGE', targetId: 'm9' } })],
    });
    const { rerender } = render(<MediaViewer />);
    expect(h.report).toMatchObject({ targetType: 'POST', targetId: 'p1' });
    setState({ ...h.state, index: 1 });
    rerender(<MediaViewer />);
    expect(h.report).toMatchObject({ targetType: 'MESSAGE', targetId: 'm9' });
  });

  it('ignores a malformed report', () => {
    setState({ meta: { report: { targetType: 'POST', targetId: '' } } });
    render(<MediaViewer />);
    expect(reportBtn()).toBeNull();
  });
});

describe('already reported is per target (MV-011)', () => {
  it('marks only the reported target, and it survives reopening', () => {
    setState({
      items: [
        IMG({ report: { targetType: 'POST', targetId: 'p1' } }),
        IMG({ slideKey: '1:b', report: { targetType: 'POST', targetId: 'p2' } }),
      ],
    });
    const { rerender, unmount } = render(<MediaViewer />);
    act(() => h.report.onSubmitted());
    expect(screen.getByRole('button', { name: 'Already reported' }).disabled).toBe(true);
    setState({ ...h.state, index: 1 });
    rerender(<MediaViewer />);
    expect(screen.getByRole('button', { name: 'Report' }).disabled).toBe(false);
    unmount();

    // A new open of the first item still knows.
    setState({ ...h.state, index: 0, sessionId: 2 });
    render(<MediaViewer />);
    expect(screen.getByRole('button', { name: 'Already reported' })).toBeTruthy();
  });

  it('marks the target when the server says it is a duplicate (409), not for other failures', () => {
    setState({ items: [IMG({ report: { targetType: 'MESSAGE', targetId: 'm1' } })] });
    render(<MediaViewer />);
    act(() => h.report.onFailed({ status: 500 }));
    expect(screen.getByRole('button', { name: 'Report' })).toBeTruthy();
    act(() => h.report.onFailed({ status: 409 }));
    expect(screen.getByRole('button', { name: 'Already reported' })).toBeTruthy();
  });
});

describe('per-open session (MV-012)', () => {
  it('drops an open Forward sheet and report flow when the next open starts', () => {
    setState({ meta: { report: { targetType: 'MESSAGE', targetId: 'm1' } } });
    const { rerender } = render(<MediaViewer />);
    fireEvent.click(screen.getByRole('button', { name: 'Forward' }));
    fireEvent.click(screen.getByRole('button', { name: 'Report' }));
    expect(screen.getByTestId('forward-open')).toBeTruthy();
    expect(screen.getByTestId('report-open')).toBeTruthy();

    setState({ ...h.state, sessionId: 2, items: [IMG({ rawUrl: '/api/media/chat/z.png' })] });
    rerender(<MediaViewer />);
    expect(screen.queryByTestId('forward-open')).toBeNull();
    expect(screen.queryByTestId('report-open')).toBeNull();
  });
});

describe('forwarding (MV-013 viewer side)', () => {
  it('forwards the stored url, not the resolved absolute one, with a stable client id per recipient', async () => {
    render(<MediaViewer />);
    fireEvent.click(screen.getByRole('button', { name: 'Forward' }));
    expect(h.forward.msg).toEqual({ mediaUrl: '/api/media/chat/a.png', mediaType: 'image' });

    await h.forward.onConfirmForward(['a', 'b'], { operationId: 'op1' });
    expect(h.send).toHaveBeenCalledTimes(2);
    expect(h.send).toHaveBeenNthCalledWith(
      1, 'a', { text: '', mediaUrl: '/api/media/chat/a.png', mediaType: 'image' },
      undefined, undefined, undefined, undefined, undefined, undefined, { tempId: 'fwd_op1_a' },
    );
    expect(h.send.mock.calls[1][8]).toEqual({ tempId: 'fwd_op1_b' });
  });

  it('throws a partial error naming who is left, and a retry reuses the same client ids', async () => {
    h.send.mockImplementation(async (id) => { if (id === 'b') throw new Error('down'); });
    render(<MediaViewer />);
    fireEvent.click(screen.getByRole('button', { name: 'Forward' }));
    const error = await h.forward.onConfirmForward(['a', 'b'], { operationId: 'op1' }).catch((e) => e);
    expect(error).toBeInstanceOf(ForwardPartialError);
    expect(error.failedIds).toEqual(['b']);
    h.send.mockResolvedValue({});
    await h.forward.onConfirmForward(['b'], { operationId: 'op1' });
    const bIds = h.send.mock.calls.filter((c) => c[0] === 'b').map((c) => c[8].tempId);
    expect(new Set(bIds).size).toBe(1);
  });

  it.each([
    ['a blob: url', { url: 'blob:https://x/1', rawUrl: 'blob:https://x/1' }],
    ['a data: url', { url: 'data:image/png;base64,AAAA', rawUrl: 'data:image/png;base64,AAAA' }],
    ['a signed url', { url: 'https://r2.test/k.mp4?X-Amz-Signature=abc&X-Amz-Expires=3600', rawUrl: 'https://r2.test/k.mp4?X-Amz-Signature=abc&X-Amz-Expires=3600' }],
  ])('disables Forward for %s', (_name, item) => {
    setState({ items: [IMG(item)] });
    render(<MediaViewer />);
    expect(screen.getByRole('button', { name: 'Forward' }).disabled).toBe(true);
    expect(screen.queryByTestId('forward-open')).toBeNull();
  });

  it('treats a url-sniffed video without a type as a video', async () => {
    setState({ items: [IMG({ type: undefined, url: 'https://api.test/api/media/chat/v.mp4', rawUrl: '/api/media/chat/v.mp4' })] });
    render(<MediaViewer />);
    fireEvent.click(screen.getByRole('button', { name: 'Forward' }));
    expect(h.forward.msg.mediaType).toBe('video');
  });
});

describe('props handed to the slides', () => {
  it('passes the item poster to the video and a positional label to the photo', () => {
    setState({
      index: 0,
      items: [
        { url: 'https://x/v.mp4', rawUrl: 'v', type: 'video', thumb: 'https://x/t.jpg', slideKey: '0:v' },
        IMG({ slideKey: '1:a' }),
      ],
    });
    render(<MediaViewer />);
    expect(h.video.poster).toBe('https://x/t.jpg');
    expect(h.image.label).toBe('Photo 2 of 2');
  });

  it('labels a lone photo plainly', () => {
    render(<MediaViewer />);
    expect(h.image.label).toBe('Photo');
  });
});

describe('background media (MV-008)', () => {
  it('pauses everything below the viewer when it opens', () => {
    render(<MediaViewer />);
    expect(h.pauseAll).toHaveBeenCalledWith(10);
  });
});

describe('download (MV-031) and its status', () => {
  const webp = () => ({ ok: true, blob: async () => new Blob(['x'], { type: 'image/webp' }) });
  let click;
  beforeEach(() => {
    click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    URL.createObjectURL = vi.fn(() => 'blob:out');
    URL.revokeObjectURL = vi.fn();
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ drawImage: () => {} }));
    HTMLCanvasElement.prototype.toBlob = vi.fn((cb) => cb(new Blob(['p'], { type: 'image/png' })));
  });

  const start = async () => {
    render(<MediaViewer />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Download' })); });
  };

  it('announces progress through a status region', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob(['x'], { type: 'image/png' }) })));
    await start();
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Download completed'));
    expect(screen.getByRole('group', { name: 'Download' })).toBeTruthy();
  });

  it('does not save when cancelled during conversion, and still releases the bitmap', async () => {
    let finishDecode;
    const bitmap = { width: 2, height: 2, close: vi.fn() };
    vi.stubGlobal('fetch', vi.fn(async () => webp()));
    vi.stubGlobal('createImageBitmap', vi.fn(() => new Promise((res) => { finishDecode = () => res(bitmap); })));
    await start();
    await waitFor(() => expect(screen.getByText('Converting to PNG…', { selector: '[aria-hidden]' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    // Told straight away, before the decode has finished.
    expect(screen.getByRole('status').textContent).toBe('Download cancelled');
    await act(async () => { finishDecode(); });
    expect(click).not.toHaveBeenCalled();
    expect(bitmap.close).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status').textContent).toBe('Download cancelled');
  });

  it('releases the bitmap when the conversion fails', async () => {
    const bitmap = { width: 2, height: 2, close: vi.fn() };
    vi.stubGlobal('fetch', vi.fn(async () => webp()));
    vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap));
    HTMLCanvasElement.prototype.toBlob = vi.fn((cb) => cb(null));
    await start();
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Download failed'));
    expect(bitmap.close).toHaveBeenCalledTimes(1);
    expect(click).not.toHaveBeenCalled();
  });

  it('does not save a file after the viewer was unmounted mid-download', async () => {
    let finishBlob;
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: () => new Promise((res) => { finishBlob = () => res(new Blob(['x'], { type: 'image/png' })); }) })));
    render(<MediaViewer />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Download' })); });
    await waitFor(() => expect(finishBlob).toBeTypeOf('function'));
    cleanup();
    await act(async () => { finishBlob(); });
    expect(click).not.toHaveBeenCalled();
  });

  it('a stale run cannot overwrite the status of a newer one', async () => {
    let finishFirst;
    const fetcher = vi.fn()
      .mockImplementationOnce(async () => ({ ok: true, blob: () => new Promise((res) => { finishFirst = () => res(new Blob(['1'], { type: 'image/png' })); }) }))
      .mockImplementation(async () => ({ ok: true, blob: async () => new Blob(['2'], { type: 'image/png' }) }));
    vi.stubGlobal('fetch', fetcher);
    await start();
    await waitFor(() => expect(finishFirst).toBeTypeOf('function'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await new Promise((r) => setTimeout(r, 2100));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Download' })); });
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Download completed'));
    await act(async () => { finishFirst(); });
    expect(screen.getByRole('status').textContent).toBe('Download completed');
    expect(click).toHaveBeenCalledTimes(1);
  }, 8000);
});

describe('keyboard when focus has fallen to <body>', () => {
  it('still closes on Escape (the focused control was hidden and made inert)', () => {
    render(<MediaViewer />);
    h.pauseAll.mockClear();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(h.pauseAll).toHaveBeenCalled();
  });

  it('ignores keys aimed at an unrelated dialog elsewhere in the page', () => {
    render(<MediaViewer />);
    const other = document.createElement('div');
    other.setAttribute('role', 'dialog');
    document.body.append(other);
    h.pauseAll.mockClear();
    fireEvent.keyDown(other, { key: 'Escape' });
    expect(h.pauseAll).not.toHaveBeenCalled();
    other.remove();
  });
});
