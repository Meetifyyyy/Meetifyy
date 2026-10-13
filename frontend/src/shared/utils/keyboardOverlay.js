import { IS_MOBILE_BUILD } from '@config';

/**
 * Whether the on-screen keyboard OVERLAYS the page with nothing else making
 * room for it: the installed Android app.
 *
 * There the WebView keeps its full height when the keyboard opens (the native
 * side reports the keyboard as `meetifyy:ime` instead, SystemUiPlugin), so a
 * bottom-docked composer is covered unless it lifts itself, by `--kb-inset`
 * (useKeyboardInset, which takes its overlay path on this same flag). Elsewhere something already handles it, and lifting too
 * would do it twice:
 *   - iOS, app and Safari: the visual viewport shrinks and pans to the field,
 *     and the Messages layout subtracts `--kb-inset` from its own height
 *     (global.css, `.centre--messages`);
 *   - the website on Android: the browser resizes the layout viewport.
 *
 * Takes its inputs so tests can ask about any platform; the export below is the
 * answer for this build.
 */
export function keyboardOverlaysPage({ mobileBuild = IS_MOBILE_BUILD, userAgent } = {}) {
  const ua = userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent || '' : '');
  return Boolean(mobileBuild) && /Android/i.test(ua);
}

/** Fixed for the life of the page: neither the build nor the platform changes. */
export const KEYBOARD_OVERLAYS_PAGE = keyboardOverlaysPage();
