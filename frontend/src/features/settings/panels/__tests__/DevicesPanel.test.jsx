/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const list = vi.fn();
const revoke = vi.fn();
vi.mock('@shared/api/apiClient', () => ({
  sessionsApi: { list: (...a) => list(...a), revoke: (...a) => revoke(...a), revokeOthers: vi.fn() },
}));
vi.mock('@shared/utils/toast', () => ({ showToast: vi.fn() }));

import DevicesPanel from '../DevicesPanel';

const renderPanel = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DevicesPanel />
    </QueryClientProvider>,
  );

const now = new Date().toISOString();

describe('DevicesPanel', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('never shows an IP address, even if the API sent one', async () => {
    list.mockResolvedValue([
      { id: 'a', deviceName: 'Chrome on Windows', client: 'web', current: true, lastActiveAt: now, ip: '203.0.113.9' },
      { id: 'b', deviceName: 'Meetifyy app on Android', client: 'app', current: false, lastActiveAt: now, ip: '198.51.100.4' },
    ]);
    const { container } = renderPanel();
    await screen.findByText('Chrome on Windows');
    expect(container.textContent).not.toMatch(/203\.0\.113\.9|198\.51\.100\.4/);
  });

  it('labels the app and the website, and marks the current device', async () => {
    list.mockResolvedValue([
      { id: 'a', deviceName: 'Chrome on Windows', client: 'web', current: true, lastActiveAt: now },
      { id: 'b', deviceName: 'Meetifyy app on Android', client: 'app', current: false, lastActiveAt: now },
    ]);
    renderPanel();
    await screen.findByText('Meetifyy app on Android');
    expect(screen.getByText(/Website · Active now/)).toBeTruthy();
    expect(screen.getByText(/Meetifyy app · Last active/)).toBeTruthy();
    expect(screen.getByText(/This device/)).toBeTruthy();
    // Only the other device can be signed out from here.
    expect(screen.getAllByRole('button', { name: /^Sign out (?!of all)/ })).toHaveLength(1);
  });

  it('signs out the chosen device through the revoke call', async () => {
    list.mockResolvedValue([
      { id: 'a', deviceName: 'Chrome on Windows', client: 'web', current: true, lastActiveAt: now },
      { id: 'b', deviceName: 'Firefox on Linux', client: 'web', current: false, lastActiveAt: now },
    ]);
    revoke.mockResolvedValue({ success: true });
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out Firefox on Linux' }));
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('b'));
  });

  it('offers a retry when the list cannot be loaded', async () => {
    list.mockRejectedValue(new Error('down'));
    renderPanel();
    expect(await screen.findByText(/Couldn.t load your devices/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
