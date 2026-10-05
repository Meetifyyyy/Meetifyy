/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const host = vi.hoisted(() => ({
  open: false, close: vi.fn(), recover: vi.fn(() => false), loads: 0,
}));
vi.mock('@shared/context/MediaViewerContext', () => ({
  useMediaViewerState: () => ({ open: host.open }),
  useMediaViewerActions: () => ({ closeViewer: host.close }),
}));
vi.mock('@shared/lib/staleChunkRecovery', () => ({ recoverFromStaleChunk: host.recover }));
/** Decides what the next dynamic `import('./MediaViewer')` does. */
function mockViewerModule(error) {
  vi.doMock('../MediaViewer', () => {
    host.loads += 1;
    if (error) throw error;
    return { default: () => <div data-testid="viewer" /> };
  });
}

let Host;
beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  host.open = false;
  host.loads = 0;
  mockViewerModule(null);
  vi.resetModules();
  ({ default: Host } = await import('../MediaViewerHost'));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });


describe('media viewer host', () => {
  it('renders nothing until something opens the viewer', () => {
    const { container } = render(<Host />);
    expect(container.firstChild).toBeNull();
    expect(host.loads).toBe(0);
  });

  it('shows a loading card while the chunk is in flight, then the viewer', async () => {
    host.open = true;
    render(<Host />);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(await screen.findByTestId('viewer')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('offers Retry and Close instead of unmounting the app when the chunk fails', async () => {
    const failure = new Error('Failed to fetch dynamically imported module: /assets/MediaViewer.js');
    mockViewerModule(failure);
    host.open = true;
    render(<Host />);
    expect(await screen.findByRole('alertdialog')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    // The mocker wraps a throwing factory, so assert on the kind of error, not identity.
    expect(host.recover).toHaveBeenCalledWith(expect.any(Error));
    expect(failure).toBeInstanceOf(Error);
  });

  it('Close dismisses the viewer state', async () => {
    mockViewerModule(new Error('boom'));
    host.open = true;
    render(<Host />);
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
    expect(host.close).toHaveBeenCalledOnce();
  });

  it('Try again builds a fresh lazy component and loads the viewer', async () => {
    mockViewerModule(new Error('Failed to fetch dynamically imported module'));
    host.open = true;
    render(<Host />);
    expect(await screen.findByRole('alertdialog')).toBeTruthy();

    mockViewerModule(null);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })); });
    expect(await screen.findByTestId('viewer')).toBeTruthy();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('shows nothing for a failed viewer while the viewer is closed', async () => {
    mockViewerModule(new Error('boom'));
    host.open = true;
    const { rerender, container } = render(<Host />);
    await screen.findByRole('alertdialog');
    host.open = false;
    rerender(<Host />);
    expect(container.firstChild).toBeNull();
  });
});
