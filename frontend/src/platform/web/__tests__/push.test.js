/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createWebPush, base64UrlToBytes } from '../push';

/**
 * The website's PushService: honest unsupported states, never prompting on
 * its own, a subscription tied to the server's current key, and page-side
 * re-validation of every click the service worker forwards.
 */
const KEY = 'BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

let messageHandler = null;

function install({ permission = 'default', registration = null, pushManager = true } = {}) {
  messageHandler = null;
  const sw = {
    getRegistration: vi.fn(async () => registration),
    addEventListener: vi.fn((type, fn) => {
      if (type === 'message') messageHandler = fn;
    }),
  };
  Object.defineProperty(navigator, 'serviceWorker', { value: sw, configurable: true });
  if (pushManager) window.PushManager = function PushManager() {};
  else delete window.PushManager;
  window.Notification = { permission, requestPermission: vi.fn(async () => 'granted') };
  return sw;
}

const subscription = (keyBytes) => ({
  options: { applicationServerKey: keyBytes.buffer },
  unsubscribe: vi.fn(async () => true),
  toJSON: () => ({
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
    keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) },
  }),
});

describe('web PushService', () => {
  afterEach(() => {
    delete window.PushManager;
    delete window.Notification;
  });

  it('reports no-worker on hosts without the service worker (dev deployments)', async () => {
    install({ registration: null });
    const push = createWebPush();
    expect(await push.unsupportedReason()).toBe('no-worker');
    expect(await push.permissionState()).toBe('unsupported');
    expect(await push.requestPermission()).toBe('unsupported');
    expect(window.Notification.requestPermission).not.toHaveBeenCalled();
  });

  it('reports browser when the Push API is missing', async () => {
    install({ pushManager: false });
    expect(await createWebPush().unsupportedReason()).toMatch(/browser|install/);
  });

  it('maps permission without prompting', async () => {
    install({ permission: 'default', registration: { pushManager: {} } });
    const push = createWebPush();
    expect(await push.permissionState()).toBe('prompt');
    expect(window.Notification.requestPermission).not.toHaveBeenCalled();
  });

  it('never subscribes without granted permission', async () => {
    const subscribe = vi.fn();
    install({ permission: 'default', registration: { pushManager: { getSubscription: vi.fn(), subscribe } } });
    expect(await createWebPush().getRegistration({ webPushPublicKey: KEY })).toBeNull();
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('replaces a subscription made with another key', async () => {
    const stale = subscription(new Uint8Array([1, 2, 3]));
    const fresh = subscription(base64UrlToBytes(KEY));
    const pushManager = {
      getSubscription: vi.fn(async () => stale),
      subscribe: vi.fn(async () => fresh),
    };
    install({ permission: 'granted', registration: { pushManager } });
    const reg = await createWebPush().getRegistration({ webPushPublicKey: KEY });
    expect(stale.unsubscribe).toHaveBeenCalled();
    expect(pushManager.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ userVisibleOnly: true }),
    );
    expect(reg).toMatchObject({ platform: 'WEB', token: 'https://fcm.googleapis.com/fcm/send/abc' });
  });

  it('routes only validated in-app paths forwarded by the worker', () => {
    install({ registration: null });
    const push = createWebPush();
    const taps = [];
    push.onNotificationTap((intent) => taps.push(intent));
    messageHandler({ data: { type: 'meetifyy:push-open', path: '//evil.example/x' } });
    messageHandler({ data: { type: 'meetifyy:push-open', path: 'https://evil.example/' } });
    messageHandler({ data: { type: 'meetifyy:push-open', path: '/admin/secret' } });
    messageHandler({ data: { type: 'meetifyy:push-open', path: '/post/p1' } });
    expect(taps).toEqual([{ t: 'post', id: 'p1' }]);
  });

  it('holds a tap that arrived before anyone listened', () => {
    install({ registration: null });
    const push = createWebPush();
    messageHandler({ data: { type: 'meetifyy:push-open', path: '/messages/pub-1' } });
    expect(push.takePendingTap()).toEqual({ t: 'chat', conversationId: 'pub-1' });
    expect(push.takePendingTap()).toBeNull();
  });

  it('deleteToken unsubscribes this browser', async () => {
    const sub = subscription(base64UrlToBytes(KEY));
    install({ permission: 'granted', registration: { pushManager: { getSubscription: vi.fn(async () => sub) } } });
    await createWebPush().deleteToken();
    expect(sub.unsubscribe).toHaveBeenCalled();
  });
});
