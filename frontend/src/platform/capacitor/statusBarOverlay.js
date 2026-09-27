import { registerPlugin } from '@capacitor/core';

/**
 * Lets a screen draw behind a transparent Android status bar.
 *
 * Backed by `setStatusBarOverlay` on our `SystemUi` plugin
 * (`android/app/src/main/java/app/meetifyy/SystemUiPlugin.java`), which drops
 * the top window padding and publishes the status bar's height to CSS as
 * `--status-bar-inset`. Failures are swallowed: on iOS and in the web preview
 * the plugin does not exist, and the page simply keeps an opaque bar.
 */
const SystemUi = registerPlugin('SystemUi');

export function setStatusBarOverlay(enabled, {
  lightIcons = true,
  navigationEnabled = false,
  navigationLightIcons = true,
} = {}) {
  return SystemUi.setStatusBarOverlay({ enabled, lightIcons, navigationEnabled, navigationLightIcons }).catch(() => {});
}
