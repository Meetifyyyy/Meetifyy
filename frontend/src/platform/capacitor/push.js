import { registerPlugin } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { parseIntent } from '../../core/navigation/intents';

/**
 * Native push on Android (FCM through @capacitor/push-notifications), as a
 * `PushService` (platform/contracts.ts). See docs/push-notifications.md.
 *
 * Never imported statically by shared code: `shared/push/pushPlatform` loads
 * this with `import()` under IS_MOBILE_BUILD, because importing a Capacitor
 * plugin registers it as a side effect and that must not reach the website.
 *
 * Firebase is configured per build type (android/app/src/debug|release/
 * google-services.json). A build without it must not call `register()`: the
 * Firebase SDK throws on an uninitialised app. `PushSupport.status()` (a tiny
 * native plugin, PushSupportPlugin.java) reports whether the build has it.
 *
 * CHANNEL IDS ARE A CONTRACT with the server (backend/src/push/push.types.ts
 * CATEGORY_CHANNEL) and with every APK already installed: a channel's
 * importance belongs to the user once created. Never rename or repurpose one.
 */
const PushSupport = registerPlugin('PushSupport');

export const PUSH_CHANNELS = [
  { id: 'messages', name: 'Messages', description: 'Direct and group messages', importance: 4 },
  { id: 'social', name: 'Likes, comments and follows', description: 'Activity on your posts and profile', importance: 3 },
  { id: 'activity', name: 'Activities', description: 'Invites and people joining your activities', importance: 3 },
  { id: 'community', name: 'Communities', description: 'People joining or asking to join your communities', importance: 3 },
];

const REGISTRATION_TIMEOUT_MS = 15_000;

export function createCapacitorPush() {
  const tapListeners = new Set();
  const tokenListeners = new Set();
  let pending = null;
  let token = null;
  let waiters = [];
  let configured = null;

  const isConfigured = async () => {
    if (configured !== null) return configured;
    try {
      const status = await PushSupport.status();
      configured = Boolean(status?.configured);
    } catch {
      // An APK without the native helper (or a non-Android shell).
      configured = false;
    }
    return configured;
  };

  const settle = (value) => {
    waiters.forEach((resolve) => resolve(value));
    waiters = [];
  };

  // Listeners are attached at creation, before React mounts, so the tap that
  // cold-started the app is caught and held for the navigator to drain.
  PushNotifications.addListener('registration', ({ value }) => {
    const changed = token !== null && token !== value;
    token = value;
    settle(value);
    if (changed) tokenListeners.forEach((l) => l());
  }).catch(() => {});
  PushNotifications.addListener('registrationError', () => settle(null)).catch(() => {});
  PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    const intent = parseIntent(action?.notification?.data);
    if (!intent) return;
    if (tapListeners.size === 0) pending = intent;
    else tapListeners.forEach((l) => l(intent));
  }).catch(() => {});
  // Foreground: the system shows no banner, and the open app already reflects
  // the event through its socket (bell, chat badge). Nothing to do here.

  const ensureChannels = async () => {
    await Promise.all(
      PUSH_CHANNELS.map((c) =>
        PushNotifications.createChannel({ ...c, visibility: 0 }).catch(() => {}),
      ),
    );
  };

  return {
    async unsupportedReason() {
      return (await isConfigured()) ? null : 'not-configured';
    },

    async permissionState() {
      if (!(await isConfigured())) return 'unsupported';
      try {
        const { receive } = await PushNotifications.checkPermissions();
        if (receive === 'granted' || receive === 'denied') return receive;
        return 'prompt';
      } catch {
        return 'unsupported';
      }
    },

    async requestPermission() {
      if (!(await isConfigured())) return 'unsupported';
      try {
        const { receive } = await PushNotifications.requestPermissions();
        return receive === 'granted' ? 'granted' : 'denied';
      } catch {
        return 'denied';
      }
    },

    async getRegistration() {
      if ((await this.permissionState()) !== 'granted') return null;
      await ensureChannels();
      if (!token) {
        const next = new Promise((resolve) => {
          waiters.push(resolve);
          setTimeout(() => resolve(null), REGISTRATION_TIMEOUT_MS);
        });
        await PushNotifications.register().catch(() => settle(null));
        await next;
      }
      return token ? { platform: 'ANDROID', token } : null;
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
      token = null;
      if (!(await isConfigured())) return;
      await PushNotifications.unregister().catch(() => {});
      await PushNotifications.removeAllDeliveredNotifications().catch(() => {});
    },

    async openSystemSettings() {
      await PushSupport.openSettings().catch(() => {});
    },
  };
}
