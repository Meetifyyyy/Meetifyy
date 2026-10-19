import { parseIntentFromPath } from '../../core/navigation/intents';

/**
 * Web Push, as a `PushService` (platform/contracts.ts). See
 * docs/push-notifications.md.
 *
 * Standards only: the Push API through the site's own service worker
 * (src/sw.js) and a VAPID key from the API. No Firebase on the web.
 *
 * The service worker exists only on production deployments (main.jsx tears it
 * down on dev/preview hosts, and non-production builds ship a tombstone), so
 * there this reports 'unsupported' / 'no-worker' and the UI says so. Nothing
 * here ever prompts on its own: `requestPermission` is called only from a
 * click in Settings.
 */

const isIos = () =>
  typeof navigator !== 'undefined' &&
  (/iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

const apiPresent = () =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

/** VAPID public keys arrive base64url; `subscribe` wants the raw bytes. */
export function base64UrlToBytes(value) {
  const padded = `${value}${'='.repeat((4 - (value.length % 4)) % 4)}`
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

const sameKey = (buffer, bytes) => {
  if (!buffer) return false;
  const a = new Uint8Array(buffer);
  return a.length === bytes.length && a.every((v, i) => v === bytes[i]);
};

async function workerRegistration() {
  if (!apiPresent()) return null;
  try {
    return (await navigator.serviceWorker.getRegistration('/')) || null;
  } catch {
    return null;
  }
}

/**
 * Only same-origin, in-app paths the Intent parser recognises are routed. The
 * worker already resolved the path from a validated intent; this is the
 * second check, on the page side, before anything navigates.
 */
function intentFromWorkerMessage(data) {
  if (!data || typeof data !== 'object') return null;
  if (data.type !== 'meetifyy:push-open' || typeof data.path !== 'string') return null;
  if (!data.path.startsWith('/') || data.path.startsWith('//')) return null;
  return parseIntentFromPath(data.path);
}

export function createWebPush() {
  const tapListeners = new Set();
  const tokenListeners = new Set();
  let pending = null;

  if (apiPresent()) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'meetifyy:push-resubscribe') {
        tokenListeners.forEach((l) => l());
        return;
      }
      const intent = intentFromWorkerMessage(event.data);
      if (!intent) return;
      if (tapListeners.size === 0) pending = intent;
      else tapListeners.forEach((l) => l(intent));
    });
  }

  return {
    async unsupportedReason() {
      if (!apiPresent()) return isIos() ? 'install' : 'browser';
      if (!(await workerRegistration())) return 'no-worker';
      return null;
    },

    async permissionState() {
      if ((await this.unsupportedReason()) !== null) return 'unsupported';
      const p = Notification.permission;
      return p === 'default' ? 'prompt' : p;
    },

    async requestPermission() {
      if ((await this.unsupportedReason()) !== null) return 'unsupported';
      try {
        const result = await Notification.requestPermission();
        return result === 'granted' ? 'granted' : 'denied';
      } catch {
        return 'denied';
      }
    },

    async getRegistration({ webPushPublicKey } = {}) {
      if (!webPushPublicKey || Notification?.permission !== 'granted') return null;
      const reg = await workerRegistration();
      if (!reg) return null;
      const key = base64UrlToBytes(webPushPublicKey);
      let sub = await reg.pushManager.getSubscription();
      // A subscription made with another key (a rotated key, or another
      // environment's) can never receive this server's pushes.
      if (sub && !sameKey(sub.options?.applicationServerKey, key)) {
        await sub.unsubscribe().catch(() => {});
        sub = null;
      }
      if (!sub) {
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      }
      const json = sub.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return null;
      return { platform: 'WEB', token: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth };
    },

    onToken(listener) {
      tokenListeners.add(listener);
      return () => tokenListeners.delete(listener);
    },

    onNotificationTap(listener) {
      tapListeners.add(listener);
      return () => tapListeners.delete(listener);
    },

    takePendingTap() {
      const intent = pending;
      pending = null;
      return intent;
    },

    async deleteToken() {
      const reg = await workerRegistration();
      const sub = reg ? await reg.pushManager.getSubscription().catch(() => null) : null;
      if (sub) await sub.unsubscribe().catch(() => {});
    },
  };
}
