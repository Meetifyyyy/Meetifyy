import { pushApi } from '@shared/api/apiClient';
import { IS_MOBILE_BUILD, config } from '@config';
import { getPushService } from './pushPlatform';

/**
 * Push registration, in one place, for Settings, the opt-in card, sign-in and
 * sign-out. See docs/push-notifications.md.
 *
 * Three separate things, never conflated:
 *  - the OS/browser PERMISSION (granted / denied / prompt / unsupported),
 *  - the account's push PREFERENCE (server: `enabled` + categories),
 *  - this device's REGISTRATION with the API.
 * A device is registered only when the first two allow it, and only while
 * signed in. Nothing here prompts except `enablePush`, which callers invoke
 * from a click.
 */

const APP_VERSION =
  typeof __MEETIFYY_APP_VERSION__ === 'string' ? __MEETIFYY_APP_VERSION__ : undefined;

let serverConfig = null;
let lastRegistered = null; // `${userId}|${token}` already sent this page life

async function getServerConfig() {
  if (serverConfig) return serverConfig;
  try {
    serverConfig = await pushApi.getConfig();
  } catch {
    return { enabled: false, web: false, android: false, webPushPublicKey: null };
  }
  return serverConfig;
}

/** Is push offered at all for this client by this deployment? */
function platformOffered(cfg) {
  return IS_MOBILE_BUILD ? Boolean(cfg?.android) : Boolean(cfg?.web);
}

/**
 * Everything Settings needs to describe the state honestly.
 * `available: false` with a `reason` means "explain, do not offer a button".
 */
export async function getPushStatus() {
  const [cfg, service] = await Promise.all([getServerConfig(), getPushService()]);
  if (!service) return { available: false, reason: 'browser', permission: 'unsupported' };
  const reason = await service.unsupportedReason();
  if (reason) return { available: false, reason, permission: 'unsupported' };
  if (!platformOffered(cfg)) return { available: false, reason: 'server', permission: 'unsupported' };
  const permission = await service.permissionState();
  return {
    available: true,
    reason: null,
    permission,
    canOpenSettings: typeof service.openSystemSettings === 'function',
  };
}

/** Registers this device if permission and the account preference allow. Never prompts. */
export async function syncPushRegistration({ userId, enabled }) {
  if (!userId || !enabled) return false;
  try {
    const [cfg, service] = await Promise.all([getServerConfig(), getPushService()]);
    if (!service || !platformOffered(cfg)) return false;
    if ((await service.permissionState()) !== 'granted') return false;
    const registration = await service.getRegistration({ webPushPublicKey: cfg.webPushPublicKey });
    if (!registration) return false;
    const key = `${userId}|${registration.token}`;
    if (lastRegistered === key) return true;
    await pushApi.registerDevice({
      ...registration,
      ...(APP_VERSION && /^[0-9A-Za-z.+_-]{1,32}$/.test(APP_VERSION) ? { appVersion: APP_VERSION } : {}),
    });
    lastRegistered = key;
    return true;
  } catch (err) {
    if (config.isDevelopment) console.warn('[push] registration failed', err);
    return false;
  }
}

/**
 * "Turn on" from a click: ask the OS, then switch the account preference on
 * and register this device. Returns the resulting permission.
 */
export async function enablePush({ userId }) {
  const service = await getPushService();
  if (!service) return 'unsupported';
  const permission = await service.requestPermission();
  if (permission !== 'granted') return permission;
  await pushApi.updatePreferences({ enabled: true });
  lastRegistered = null;
  await syncPushRegistration({ userId, enabled: true });
  return 'granted';
}

/** Switch the account preference off and drop this device's registration. */
export async function disablePush() {
  await pushApi.updatePreferences({ enabled: false });
  await forgetThisDevice({ server: true });
}

/**
 * Sign-out / account switch: stop this device receiving the account's pushes.
 *
 * The server already deletes the registration when the login is revoked
 * (UserSessionService), so `server: false` is the logout path and only the
 * local subscription/token is dropped. With `server: true` the row is removed
 * first, while the session that owns it is still valid.
 */
export async function forgetThisDevice({ server = false } = {}) {
  lastRegistered = null;
  try {
    const service = await getPushService();
    if (!service) return;
    if (server) {
      const cfg = await getServerConfig();
      const registration = await service
        .getRegistration({ webPushPublicKey: cfg.webPushPublicKey })
        .catch(() => null);
      if (registration) await pushApi.unregisterDevice(registration.token).catch(() => {});
    }
    await service.deleteToken();
  } catch {
    // Best effort: the server-side revocation is the guarantee.
  }
}

/** For tests. */
export function __resetPushRegistrationForTests() {
  serverConfig = null;
  lastRegistered = null;
}
