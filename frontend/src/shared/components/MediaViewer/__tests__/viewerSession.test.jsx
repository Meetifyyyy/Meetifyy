/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const auth = vi.hoisted(() => ({ isLoggedIn: true }));
vi.mock('@shared/api/apiClient', () => ({ getMediaUrl: (value) => value }));
vi.mock('@shared/context/AuthContext', () => ({ useAuth: () => ({ isLoggedIn: auth.isLoggedIn }) }));

const { MediaViewerProvider, useMediaViewer } = await import('@shared/context/MediaViewerContext');
const { hasReportedTarget, markTargetReported, clearReportedTargets, reportKey } = await import('@shared/utils/reportedTargets');

let api;
function Probe() { api = useMediaViewer(); return null; }
const tree = () => (
  <MemoryRouter><MediaViewerProvider><Probe /></MediaViewerProvider></MemoryRouter>
);
const items = [{ url: 'https://x/a.png', type: 'image' }];

beforeEach(() => { auth.isLoggedIn = true; clearReportedTargets(); });
afterEach(() => cleanup());

describe('viewer session identity', () => {
  it('starts a new session on every open, even while one is already open', () => {
    render(tree());
    const first = api.state.sessionId;
    act(() => api.openViewer(items));
    const second = api.state.sessionId;
    act(() => api.openViewer(items));
    expect(second).toBe(first + 1);
    expect(api.state.sessionId).toBe(second + 1);
  });

  it('keeps the session across closing and paging', () => {
    render(tree());
    act(() => api.openViewer([...items, ...items]));
    const id = api.state.sessionId;
    act(() => api.navigate(1));
    act(() => api.closeViewer());
    expect(api.state.sessionId).toBe(id);
  });
});

describe('reported targets', () => {
  it('are keyed by type and id', () => {
    expect(reportKey({ targetType: 'POST', targetId: 'p1' })).toBe('POST:p1');
    markTargetReported('POST:p1');
    expect(hasReportedTarget('POST:p1')).toBe(true);
    expect(hasReportedTarget('POST:p2')).toBe(false);
    expect(hasReportedTarget('MESSAGE:p1')).toBe(false);
  });

  it('are forgotten when the account signs out', () => {
    const view = render(tree());
    markTargetReported('POST:p1');
    auth.isLoggedIn = false;
    view.rerender(<MemoryRouter><MediaViewerProvider><Probe /></MediaViewerProvider><span /></MemoryRouter>);
    expect(hasReportedTarget('POST:p1')).toBe(false);
  });
});
