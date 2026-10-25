import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * The video player's fullscreen, done by the Android shell
 * (MediaFullscreenPlugin.java): the bars hidden, the screen turned for a wide
 * clip, and kept on. The web Fullscreen API cannot do it in the app, because
 * Capacitor's WebChromeClient leaves fullscreen the moment it is entered.
 *
 * Null where the shell has no such plugin (iOS), so the player falls back to
 * the native one there.
 */
const MediaFullscreen = registerPlugin('MediaFullscreen');

export function createNativeMediaFullscreenDriver() {
  if (Capacitor.getPlatform() !== 'android') return null;
  return {
    /** Resolves true once the window is fullscreen, false if the shell refused. */
    async enter({ landscape = false } = {}) {
      try {
        await MediaFullscreen.enter({ landscape });
        return true;
      } catch {
        return false;
      }
    },
    async exit() {
      try {
        await MediaFullscreen.exit();
      } catch {
        // Nothing to restore.
      }
    },
  };
}
