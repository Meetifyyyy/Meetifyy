import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The installed app's PushService: no Firebase call at all in a build without
 * its configuration, taps reduced to validated Intents (including the tap
 * that cold-started the app), and logout dropping the token.
 */
const listeners = {};
const plugin = {
  addListener: vi.fn(async (name, fn) => {
    listeners[name] = fn;
    return { remove: vi.fn() };
  }),
  checkPermissions: vi.fn(async () => ({ receive: 'granted' })),
  requestPermissions: vi.fn(async () => ({ receive: 'granted' })),
  register: vi.fn(async () => {
    listeners.registration?.({ value: 'fcm-token-1' });
  }),
  unregister: vi.fn(async () => {}),
  removeAllDeliveredNotifications: vi.fn(async () => {}),
  createChannel: vi.fn(async () => {}),
};
const support = { status: vi.fn(async () => ({ configured: true })), openSettings: vi.fn(async () => {}) };

vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: plugin }));
vi.mock('@capacitor/core', () => ({ registerPlugin: () => support }));

const { createCapacitorPush, PUSH_CHANNELS } = await import('../push');

describe('Capacitor PushService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    support.status.mockResolvedValue({ configured: true });
  });

  it('a build without google-services.json never touches Firebase', async () => {
    support.status.mockResolvedValue({ configured: false });
    const push = createCapacitorPush();
    expect(await push.permissionState()).toBe('unsupported');
    expect(await push.unsupportedReason()).toBe('not-configured');
    expect(await push.getRegistration({})).toBeNull();
    expect(plugin.register).not.toHaveBeenCalled();
    expect(plugin.requestPermissions).not.toHaveBeenCalled();
  });

  it('registers only with permission, creating the contract channels first', async () => {
    const push = createCapacitorPush();
    const reg = await push.getRegistration({});
    expect(reg).toEqual({ platform: 'ANDROID', token: 'fcm-token-1' });
    expect(plugin.createChannel.mock.calls.map((c) => c[0].id)).toEqual(PUSH_CHANNELS.map((c) => c.id));
    expect(PUSH_CHANNELS.map((c) => c.id)).toEqual(['messages', 'social', 'activity', 'community']);
  });

  it('does not register while permission is undecided or denied', async () => {
    plugin.checkPermissions.mockResolvedValueOnce({ receive: 'prompt' });
    const push = createCapacitorPush();
    expect(await push.getRegistration({})).toBeNull();
    expect(plugin.register).not.toHaveBeenCalled();
  });

  it('turns a tap into a validated Intent, holding a cold-start tap', () => {
    const push = createCapacitorPush();
    listeners.pushNotificationActionPerformed({ notification: { data: { v: '1', t: 'community', id: 'k1' } } });
    expect(push.takePendingTap()).toEqual({ t: 'community', id: 'k1' });
    const taps = [];
    push.onNotificationTap((i) => taps.push(i));
    listeners.pushNotificationActionPerformed({ notification: { data: { url: 'https://evil.example' } } });
    listeners.pushNotificationActionPerformed({ notification: { data: { t: 'activity', id: 'a1' } } });
    expect(taps).toEqual([{ t: 'activity', id: 'a1' }]);
  });

  it('reports a rotated token so the app re-registers', async () => {
    const push = createCapacitorPush();
    await push.getRegistration({});
    const onToken = vi.fn();
    push.onToken(onToken);
    listeners.registration({ value: 'fcm-token-2' });
    expect(onToken).toHaveBeenCalledTimes(1);
  });

  it('logout unregisters and clears delivered notifications', async () => {
    const push = createCapacitorPush();
    await push.deleteToken();
    expect(plugin.unregister).toHaveBeenCalled();
    expect(plugin.removeAllDeliveredNotifications).toHaveBeenCalled();
  });
});
