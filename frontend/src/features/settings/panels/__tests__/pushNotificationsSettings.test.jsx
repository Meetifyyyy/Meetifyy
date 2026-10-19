/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

/**
 * Settings shows the device's permission state separately from the account
 * preference, explains unavailable and blocked states instead of offering a
 * switch that cannot work, and asks the OS only when the switch is turned on.
 */
const status = vi.fn();
const enablePush = vi.fn(async () => 'granted');
const prefs = { enabled: false, categories: { messages: true, likes: true } };

vi.mock('@shared/context/AuthContext', () => ({ useAuth: () => ({ currentUser: { id: 'u1' } }) }));
vi.mock('@shared/utils/toast', () => ({ showToast: vi.fn() }));
vi.mock('@shared/api/apiClient', () => ({
  pushApi: { getPreferences: vi.fn(async () => prefs), updatePreferences: vi.fn(async () => prefs) },
}));
vi.mock('@shared/push/pushPlatform', () => ({ getPushService: async () => ({ openSystemSettings: vi.fn() }) }));
vi.mock('@shared/push/pushRegistration', () => ({
  getPushStatus: () => status(),
  enablePush: (...a) => enablePush(...a),
  disablePush: vi.fn(async () => {}),
}));

const { default: PushNotificationsSettings } = await import('../PushNotificationsSettings');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PushNotificationsSettings', () => {
  it('explains why push is unavailable and offers no switch', async () => {
    status.mockResolvedValue({ available: false, reason: 'no-worker', permission: 'unsupported' });
    render(<PushNotificationsSettings />);
    expect(await screen.findByText('Not available on this version of the site.')).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('shows a blocked permission without re-asking, with a way to the system settings', async () => {
    status.mockResolvedValue({ available: true, permission: 'denied', canOpenSettings: true });
    render(<PushNotificationsSettings />);
    expect(await screen.findByText('Open settings')).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(enablePush).not.toHaveBeenCalled();
  });

  it('asks the OS only when the switch is turned on', async () => {
    status.mockResolvedValue({ available: true, permission: 'prompt', canOpenSettings: false });
    render(<PushNotificationsSettings />);
    const toggle = await screen.findByRole('checkbox');
    expect(enablePush).not.toHaveBeenCalled();
    fireEvent.click(toggle);
    await waitFor(() => expect(enablePush).toHaveBeenCalledWith({ userId: 'u1' }));
  });
});
