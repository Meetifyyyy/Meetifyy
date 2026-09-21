import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

/**
 * What build this is, from the native layer — a `DeviceInfo`.
 *
 * The version comes from the platform, not from anything JavaScript can be told:
 * `versionName` in `android/app/build.gradle` and `CFBundleShortVersionString`
 * on iOS. That matters for the update gate. A version baked into the web bundle
 * would describe the bundle, and the whole point of the gate is to reason about
 * the NATIVE container the bundle is trapped inside — the one that can only be
 * changed by installing a new build from a store.
 *
 * No new dependency: `@capacitor/app` is already here for the hardware back
 * button. Imported statically, unlike `secureStorage.js`, because nothing
 * shared reaches this file — it is imported only from `src/mobile/`, which the
 * web entry never touches, so its side effects cannot end up in the website's
 * bundle.
 */
export function createCapacitorAppInfo() {
  let cached = null;

  return {
    platform() {
      const p = Capacitor.getPlatform();
      return p === 'ios' || p === 'android' ? p : 'web';
    },

    /**
     * Empty string when the version cannot be read, never a guess.
     *
     * `evaluateVersion` treats an unreadable version as "do not gate", so a
     * failure here means the user keeps using the app. That is the right way
     * round: the alternative is a plugin hiccup locking somebody out of a build
     * that is perfectly current.
     */
    async appVersion() {
      if (cached !== null) return cached;
      try {
        const info = await App.getInfo();
        cached = typeof info?.version === 'string' ? info.version : '';
      } catch {
        cached = '';
      }
      return cached;
    },

    /** Not implemented yet; the contract allows null. */
    async installationId() {
      return null;
    },
  };
}

export default createCapacitorAppInfo;
