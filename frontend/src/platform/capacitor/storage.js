/**
 * Storage for the native shell.
 *
 * A Capacitor WebView is a browser, and it has working `localStorage`,
 * `sessionStorage` and `document.cookie` scoped to the app's own origin. So the
 * browser implementations are the correct starting point here — not a
 * placeholder, an actual fit — and re-exporting them says that more honestly
 * than copying them would.
 *
 * WHAT WILL CHANGE, AND WHY IT IS NOT CHANGING NOW
 * WebView DOM storage is evictable: both platforms may clear it under storage
 * pressure, and on iOS it can go with the app's web data. For a cached ETag or
 * a failover flag that is fine — losing either costs one round trip. For
 * anything that must survive, `@capacitor/preferences` is the durable store,
 * and swapping to it is a change to this file alone because everything above it
 * depends on `SyncKeyValueStore` rather than on `localStorage`.
 *
 * That swap belongs with the phase that adds the plugin, not here: adding a
 * dependency before anything needs it is how a plugin set grows past the point
 * where anyone can say why each one is present.
 *
 * CREDENTIALS DO NOT BELONG IN ANY OF THESE. A refresh token goes to Keychain
 * or the Android Keystore through `SecureStorage`, which has no implementation
 * here yet because the native auth design is still waiting on the spike.
 */
export {
  createWebCookieReader as createNativeCookieReader,
  createWebLocalStore as createNativeLocalStore,
  createWebSessionStore as createNativeSessionStore,
} from '../web/storage';

/**
 * The transport's notifications.
 *
 * DOM events work in a WebView, so the web implementation is reused for the
 * same reason as the stores above. It is listed separately because this is the
 * one that will NOT simply carry over to React Native: there is no `window` to
 * dispatch on there, and the replacement is an ordinary callback. The interface
 * is already shaped for that — `TransportHooks` says nothing about DOM events —
 * so it is the implementation that changes, not its callers.
 */
export { createWebTransportHooks as createNativeTransportHooks } from '../web/storage';
