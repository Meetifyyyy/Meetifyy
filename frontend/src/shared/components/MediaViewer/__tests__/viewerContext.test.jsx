/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';

const auth = vi.hoisted(() => ({ isLoggedIn: true }));
vi.mock('@shared/api/apiClient', () => ({
  getMediaUrl: (value) => (value.startsWith('/api/') ? `https://api.test${value}` : value),
}));
vi.mock('@shared/context/AuthContext', () => ({ useAuth: () => ({ isLoggedIn: auth.isLoggedIn }) }));

const { MediaViewerProvider, useMediaViewer } = await import('@shared/context/MediaViewerContext');
const { overlayManager } = await import('@shared/services/OverlayManager');
const { default: OverlayHistoryBridge } = await import('@shared/components/OverlayHistoryBridge');

let api;
let nav;
function Probe() {
  api = useMediaViewer();
  return null;
}
function NavProbe() {
  nav = useNavigate();
  return null;
}
function mount() {
  return render(
    <MemoryRouter initialEntries={['/feed']}>
      <MediaViewerProvider>
        <Probe />
      </MediaViewerProvider>
      <NavProbe />
      <OverlayHistoryBridge />
    </MemoryRouter>,
  );
}
const open = (...args) => act(() => api.openViewer(...args));

beforeEach(() => { auth.isLoggedIn = true; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('openViewer normalisation (MV-014)', () => {
  it('opens on the requested entry and resolves relative urls', () => {
    mount();
    open([{ url: '/api/media/a.png', type: 'image' }, { url: 'https://x/b.png', type: 'image' }], 1);
    expect(api.state.open).toBe(true);
    expect(api.state.index).toBe(1);
    expect(api.state.items[0].url).toBe('https://api.test/api/media/a.png');
  });

  it('keeps the original url as rawUrl and preserves every extra field', () => {
    mount();
    open([{ url: '/api/media/a.png', type: 'image', id: 'm1', report: { kind: 'x' }, thumb: '/api/media/t.png', rawUrl: undefined }]);
    const [item] = api.state.items;
    expect(item.rawUrl).toBe('/api/media/a.png');
    expect(item.id).toBe('m1');
    expect(item.report).toEqual({ kind: 'x' });
    expect(item.thumb).toBe('https://api.test/api/media/t.png');
  });

  it('accepts bare url strings as images', () => {
    mount();
    open(['https://x/a.png']);
    expect(api.state.items[0]).toMatchObject({ url: 'https://x/a.png', rawUrl: 'https://x/a.png', type: 'image' });
  });

  it('drops null and url-less entries and carries the index across the drop', () => {
    mount();
    open([null, { url: 'https://x/a.png' }, { type: 'image' }, { url: 'https://x/b.png' }], 3);
    expect(api.state.items.map((i) => i.url)).toEqual(['https://x/a.png', 'https://x/b.png']);
    expect(api.state.index).toBe(1);
  });

  it('moves to the next showable entry when the requested one is unusable', () => {
    mount();
    open([{ url: 'https://x/a.png' }, null, { url: 'https://x/c.png' }], 1);
    expect(api.state.items[api.state.index].url).toBe('https://x/c.png');
  });

  it.each([[-3, 0], [99, 2], [NaN, 0], [1.9, 1], [undefined, 0]])('clamps index %s to %s', (given, expected) => {
    mount();
    open([{ url: 'https://x/a.png' }, { url: 'https://x/b.png' }, { url: 'https://x/c.png' }], given);
    expect(api.state.index).toBe(expected);
  });

  it('does not open an empty viewer', () => {
    mount();
    open([], 0);
    open(null, 0);
    open([null, {}], 0);
    expect(api.state.open).toBe(false);
  });

  it('gives duplicate urls distinct slide keys', () => {
    mount();
    open([{ url: 'https://x/a.png' }, { url: 'https://x/a.png' }]);
    const keys = api.state.items.map((i) => i.slideKey);
    expect(new Set(keys).size).toBe(2);
  });
});

describe('closing when the page changes underneath (MV-017)', () => {
  const items = [{ url: 'https://x/a.png' }];

  it('closes on a router navigation', () => {
    mount();
    open(items);
    act(() => nav('/login'));
    expect(api.state.open).toBe(false);
  });

  it('closes on a search-only change too', () => {
    mount();
    open(items);
    act(() => nav('/feed?tab=new'));
    expect(api.state.open).toBe(false);
  });

  it('stays open when only the history state changes (an overlay push)', () => {
    mount();
    open(items);
    act(() => nav('/feed', { state: { __overlayId: 'x' } }));
    expect(api.state.open).toBe(true);
  });

  it('closes when the session ends, and not before', () => {
    const view = mount();
    open(items);
    auth.isLoggedIn = true;
    view.rerender(
      <MemoryRouter initialEntries={['/feed']}>
        <MediaViewerProvider><Probe /></MediaViewerProvider>
      </MemoryRouter>,
    );
    expect(api.state.open).toBe(true);
    auth.isLoggedIn = false;
    view.rerender(
      <MemoryRouter initialEntries={['/feed']}>
        <MediaViewerProvider><Probe /></MediaViewerProvider>
        <span />
      </MemoryRouter>,
    );
    expect(api.state.open).toBe(false);
  });

  it('does not close when nobody was ever signed in', () => {
    auth.isLoggedIn = false;
    mount();
    open(items);
    expect(api.state.open).toBe(true);
  });

  it('unsubscribes from route changes on unmount', () => {
    const view = mount();
    expect(overlayManager.routeListeners.size).toBeGreaterThan(0);
    view.unmount();
    expect(overlayManager.routeListeners.size).toBe(0);
  });
});
