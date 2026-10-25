/**
 * How the video player goes fullscreen where the web Fullscreen API cannot.
 *
 * The installed app injects a driver at its composition root (see
 * platform/capacitor/mediaFullscreen.js and mobile/main.jsx); the website sets
 * none and uses the Fullscreen API. A driver is `{ enter({ landscape }) =>
 * Promise<boolean>, exit() => Promise<void> }`.
 */
let driver = null;

export function setMediaFullscreenDriver(next) {
  driver = next || null;
}

export function getMediaFullscreenDriver() {
  return driver;
}
