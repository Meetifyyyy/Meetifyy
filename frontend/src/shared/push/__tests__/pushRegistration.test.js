import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Registration policy: a device is registered only when the OS permission and
 * the account preference both allow it, nothing prompts except the explicit
 * "turn on", and sign-out drops the local registration without depending on
 * a request the server may already refuse.
 */
const api = {
  getConfig: vi.fn(async () => ({ enabled: true, web: true, android: true, webPushPublicKey: 'KEY' })),
  registerDevice: vi.fn(async () => ({ registered: true })),
  unregisterDevice: vi.fn(async () => ({ removed: true })),
  getPreferences: vi.fn(async () => ({ enabled: true, categories: {} })),
  updatePreferences: vi.fn(async () => ({ enabled: true, categories: {} })),
};
const service = {
  unsupportedReason: vi.fn(async () => null),
  permissionState: vi.fn(async () => 'granted'),
  requestPermission: vi.fn(async () => 'granted'),
  getRegistration: vi.fn(async () => ({ platform: 'WEB', token: 'https://fcm.googleapis.com/x', p256dh: 'p', auth: 'a' })),
  deleteToken: vi.fn(async () => {}),
  onToken: vi.fn(() => () => {}),
};

vi.mock('@shared/api/apiClient', () => ({ pushApi: api }));
vi.mock('../pushPlatform', () => ({ getPushService: async () => service }));

const reg = await import('../pushRegistration');

describe('push registration policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reg.__resetPushRegistrationForTests();
  });

  it('does not register when the account preference is off', async () => {
    expect(await reg.syncPushRegistration({ userId: 'u1', enabled: false })).toBe(false);
    expect(api.registerDevice).not.toHaveBeenCalled();
  });

  it('does not register (or prompt) without granted permission', async () => {
    service.permissionState.mockResolvedValueOnce('prompt');
    expect(await reg.syncPushRegistration({ userId: 'u1', enabled: true })).toBe(false);
    expect(service.requestPermission).not.toHaveBeenCalled();
    expect(api.registerDevice).not.toHaveBeenCalled();
  });

  it('registers once per user and token, with no user id in the body', async () => {
    await reg.syncPushRegistration({ userId: 'u1', enabled: true });
    await reg.syncPushRegistration({ userId: 'u1', enabled: true });
    expect(api.registerDevice).toHaveBeenCalledTimes(1);
    expect(api.registerDevice.mock.calls[0][0]).not.toHaveProperty('userId');
  });

  it('a different account on the same device registers again (account switch)', async () => {
    await reg.syncPushRegistration({ userId: 'u1', enabled: true });
    await reg.forgetThisDevice({ server: false });
    await reg.syncPushRegistration({ userId: 'u2', enabled: true });
    expect(api.registerDevice).toHaveBeenCalledTimes(2);
  });

  it('a denied prompt leaves the preference untouched', async () => {
    service.requestPermission.mockResolvedValueOnce('denied');
    expect(await reg.enablePush({ userId: 'u1' })).toBe('denied');
    expect(api.updatePreferences).not.toHaveBeenCalled();
  });

  it('sign-out drops the local token without a server call', async () => {
    await reg.forgetThisDevice({ server: false });
    expect(service.deleteToken).toHaveBeenCalled();
    expect(api.unregisterDevice).not.toHaveBeenCalled();
  });

  it('turning push off removes this device on the server first', async () => {
    await reg.disablePush();
    expect(api.updatePreferences).toHaveBeenCalledWith({ enabled: false });
    expect(api.unregisterDevice).toHaveBeenCalledWith('https://fcm.googleapis.com/x');
    expect(service.deleteToken).toHaveBeenCalled();
  });

  it('reports unavailable when this deployment does not offer push', async () => {
    api.getConfig.mockResolvedValueOnce({ enabled: false, web: false, android: false });
    reg.__resetPushRegistrationForTests();
    expect(await reg.getPushStatus()).toMatchObject({ available: false, reason: 'server' });
  });
});
