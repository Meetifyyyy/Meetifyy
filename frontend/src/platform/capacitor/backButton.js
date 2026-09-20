import { App } from '@capacitor/app';

/**
 * Android's hardware/gesture back, as a `HardwareBackButton`.
 *
 * This file is one of the few allowed to import `@capacitor/*` at all — see the
 * boundary rule in `eslint.config.js`. Everything above it talks to the
 * interface in `platform/contracts.ts`, so replacing Capacitor means replacing
 * this file rather than hunting for back-button handling across the app.
 *
 * WHAT CAPACITOR GIVES US
 * `backButton` fires with `canGoBack`, which is the WebView's own history
 * answer and therefore already counts `pushState` entries. That matters: the
 * router pushes rather than navigating, so any hand-rolled "am I at the root"
 * check would have to duplicate the router's own bookkeeping and would drift
 * from it. Asking the WebView is both shorter and harder to get wrong.
 *
 * REGISTERING AT ALL IS THE POINT
 * Capacitor only suppresses Android's default — finish the Activity — while a
 * `backButton` listener is attached. With none attached, one press on a
 * sub-route kills the process; that was measured on a device, not assumed. So
 * the mere act of subscribing is most of the fix, and the listener body is
 * only deciding between "go back" and "the user meant to leave".
 */
export function createCapacitorBackButton() {
  return {
    onPress(listener) {
      /**
       * `addListener` is async and returns a handle. Callers get a synchronous
       * unsubscribe (that is the contract, and it is what a React effect
       * cleanup needs), so the handle is awaited behind the scenes and a flag
       * covers the window where unsubscribe runs before registration resolves
       * — otherwise a component that mounts and unmounts quickly leaks a
       * listener that outlives it and keeps answering back presses.
       */
      let cancelled = false;
      let handle = null;

      App.addListener('backButton', (info) => {
        listener({ canGoBack: Boolean(info?.canGoBack) });
      }).then((h) => {
        if (cancelled) {
          h.remove();
          return;
        }
        handle = h;
      });

      return () => {
        cancelled = true;
        if (handle) {
          handle.remove();
          handle = null;
        }
      };
    },

    exitApp() {
      return App.exitApp();
    },
  };
}

export default createCapacitorBackButton;
