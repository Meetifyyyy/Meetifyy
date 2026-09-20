/**
 * Keychain (iOS) and Keystore-backed EncryptedSharedPreferences (Android), as a
 * `SecureStorage`.
 *
 * This is where the native session credential lives, and it is the reason the
 * contract keeps `SecureStorage` separate from `KeyValueStore`: the two are not
 * interchangeable, and confusing them means putting a thirty-day refresh token
 * somewhere a file browser can read it.
 *
 * WHY THE IMPORTS ARE DYNAMIC
 * Not style — a measured bundle regression. `@aparajita/capacitor-secure-storage`
 * calls `registerPlugin()` at module scope, which is a side effect Rollup is
 * obliged to preserve. A static import therefore survives tree-shaking even
 * though `IS_MOBILE_BUILD` folds the branch that uses it away, and the plugin
 * plus `@capacitor/core` shipped to the WEBSITE. Deferring the import makes this
 * module side-effect-free, so the web build drops it entirely.
 *
 * Awaiting costs nothing here: every method on the contract is async already,
 * and the module resolves once and is cached by the runtime after that.
 */

let pluginPromise = null;
const loadPlugin = () =>
  (pluginPromise ??= import('@aparajita/capacitor-secure-storage'));

let corePromise = null;
const loadCore = () => (corePromise ??= import('@capacitor/core'));

/**
 * Refuses to run anywhere but a device.
 *
 * The plugin, like every Capacitor secure-storage plugin, falls back to
 * `localStorage` on the web platform. That fallback is worse than useless here:
 * it keeps the method names and the reassuring type, and silently downgrades
 * "Keychain" to "a string on disk that any script on the origin can read". On
 * web the session is in HttpOnly cookies that scripts cannot read by design, so
 * nothing on web has any business calling this at all — a call here is a bug in
 * the composition root, and it should sound like one.
 *
 * Checked at RUNTIME rather than against the build flag, because the mobile
 * bundle is also what `npm run dev:mobile` serves in a desktop browser, and
 * there the fallback would be just as silent.
 */
async function assertNative() {
  const { Capacitor } = await loadCore();
  if (!Capacitor.isNativePlatform()) {
    throw new Error(
      'SecureStorage was called on a non-native platform. On web the session ' +
        'lives in HttpOnly cookies; this plugin would fall back to localStorage, ' +
        'which is not secure storage. Fix the composition root rather than this check.',
    );
  }
}

export function createCapacitorSecureStorage() {
  return {
    async get(key) {
      await assertNative();
      /**
       * The plugin resolves `null` for a missing key but REJECTS on a decrypt
       * failure — which happens for real, not just in theory: restoring a
       * device backup onto new hardware, or a user clearing credentials, leaves
       * an entry whose Keystore key is gone.
       *
       * Treated as "no credential" rather than propagated, because that is what
       * it means. The alternative is an app that cannot reach its own login
       * screen because reading a token it does not have throws on the way.
       */
      try {
        const { SecureStorage } = await loadPlugin();
        const value = await SecureStorage.get(key);
        return typeof value === 'string' ? value : null;
      } catch {
        return null;
      }
    },

    async set(key, value) {
      await assertNative();
      const { SecureStorage } = await loadPlugin();
      await SecureStorage.set(key, value);
    },

    async remove(key) {
      await assertNative();
      /**
       * Removing something already absent is success, not failure. Logout runs
       * this on every key it knows about, and must not be derailed by one that
       * was never written — a logout that throws half way leaves exactly the
       * credential it was meant to destroy.
       */
      try {
        const { SecureStorage } = await loadPlugin();
        await SecureStorage.remove(key);
      } catch {
        // Already gone; that is the desired end state.
      }
    },

    async clear() {
      await assertNative();
      try {
        const { SecureStorage } = await loadPlugin();
        await SecureStorage.clear();
      } catch {
        // As above: an empty store is the goal, not the method.
      }
    },
  };
}

export default createCapacitorSecureStorage;
