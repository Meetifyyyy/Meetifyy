/**
 * Keeps the phone's system bars in step with the app's theme.
 *
 * WHY IT WATCHES THE DOM RATHER THAN SUBSCRIBING TO THE THEME
 * `ThemeContext` is shared with the website, and the website has no system bars
 * to colour. Reaching into it to add a mobile-only callback would put a
 * platform concern into code the web runs too, which is the one thing the
 * `src/mobile/` boundary exists to prevent. `data-theme` on `<html>` is the
 * observable result of that context, it is already how the stylesheet is
 * switched, and watching it needs nothing from the shared layer at all.
 *
 * The colour itself is read from CSS, so it follows the palette rather than
 * duplicating it — see `platform/capacitor/systemBars.js`.
 */
export function installSystemBars(systemBars) {
  if (!systemBars || typeof document === 'undefined') return () => {};

  const root = document.documentElement;
  // The status bar follows the page color by default. Profile and community
  // cover pages opt into drawing their cover image behind it while the
  // collapsing header is active.
  let overlayEnabled = false;
  let contentUnderlayEnabled = null;
  let overlayLightIcons = null;
  let navigationOverlayEnabled = false;
  let navigationLightIcons = null;

  const syncStatusBarOverlay = () => {
    const enabled = root.hasAttribute('data-collapsing-header');
    const contentUnderlay = enabled || root.getAttribute('data-bars') === 'transparent';
    const navigationEnabled = root.getAttribute('data-navigation-bar') === 'transparent';
    const iconPreference = root.getAttribute('data-status-bar-icons');
    const lightIcons = iconPreference === 'light'
      || (iconPreference !== 'dark' && root.getAttribute('data-theme') === 'dark');
    const navigationIconPreference = root.getAttribute('data-navigation-bar-icons');
    const lightNavigationIcons = navigationIconPreference === 'light'
      || (navigationIconPreference !== 'dark' && root.getAttribute('data-theme') === 'dark');
    if (enabled === overlayEnabled && contentUnderlay === contentUnderlayEnabled
      && lightIcons === overlayLightIcons
      && navigationEnabled === navigationOverlayEnabled
      && lightNavigationIcons === navigationLightIcons) return;
    overlayEnabled = enabled;
    contentUnderlayEnabled = contentUnderlay;
    overlayLightIcons = lightIcons;
    navigationOverlayEnabled = navigationEnabled;
    navigationLightIcons = lightNavigationIcons;
    systemBars.setStatusBarOverlay?.(enabled, {
      lightIcons,
      contentUnderlay,
      navigationEnabled,
      navigationLightIcons: lightNavigationIcons,
    });
  };

  /**
   * Applied on the next frame, not immediately.
   *
   * `data-theme` is set before the browser has recalculated styles, so reading
   * `--color-bg-white` in the same tick returns the colour that is on its way
   * out. The bars would end up one theme change behind — correct on the second
   * toggle and wrong on the first, which is the kind of bug that reads as
   * "sometimes".
   */
  let frame = 0;
  // `force` re-sends even an unchanged payload: after a resume Android may have
  // reset the bars behind our back, so "same as last time" proves nothing.
  const apply = ({ force = false } = {}) => {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = 0;
      systemBars.apply({ force });
    });
  };

  apply({ force: true });

  /**
   * `data-theme` and the optional per-screen icon hint.
   *
   * The status bar follows the page's top edge, except on cover screens that
   * explicitly draw their cover behind it. Ordinary screens receive Android's
   * top safe-area inset; cover screens manage that spacing in their layout.
   * `apply()` keeps both system bar colours in sync with their page edges.
   */
  // Forced: leaving a cover page (`data-collapsing-header`) restores the
  // status bar natively, so an unchanged page colour still has to be re-sent.
  const observer = new MutationObserver(() => {
    syncStatusBarOverlay();
    apply({ force: true });
  });
  observer.observe(root, {
    attributes: true,
    attributeFilter: [
      'data-theme',
      // Android publishes the status-bar inset as an inline custom property.
      // Re-sample after it changes so the top-edge probe follows the page.
      'style',
      'data-bars',
      'data-status-bar-icons',
      'data-navigation-bar',
      'data-navigation-bar-icons',
      'data-collapsing-header',
    ],
  });
  syncStatusBarOverlay();

  /**
   * Page changes. The bars follow the colour at the page's edges, which
   * changes on navigation, when a lazily loaded route arrives, and when data
   * replaces a loading state — all of which are DOM changes under #root.
   * Re-sampled in idle time, so a burst of mutations (a list rendering) is one
   * sample; `apply()` makes no native call when the colours are unchanged.
   */
  let idle = 0;
  const idleApply = () => {
    if (idle) return;
    const run = () => {
      idle = 0;
      apply();
    };
    idle = typeof requestIdleCallback === 'function'
      ? requestIdleCallback(run, { timeout: 150 })
      : requestAnimationFrame(run);
  };
  const pageObserver = new MutationObserver(idleApply);
  const appRoot = document.getElementById('root');
  if (appRoot) pageObserver.observe(appRoot, { childList: true, subtree: true });
  window.addEventListener('popstate', idleApply);
  // From MainActivity once the splash is removed: it painted the bars in the
  // theme colour on its way out, over whatever the page had already sent.
  const onNativeReset = () => apply({ force: true });
  window.addEventListener('meetifyy:system-bars-reset', onNativeReset);

  /**
   * Android can reset the bars when the app returns to the foreground, and a
   * theme change made in the OS while the app was away arrives as a resume
   * rather than as a DOM change.
   */
  const onVisible = () => {
    if (document.visibilityState === 'visible') apply({ force: true });
  };
  document.addEventListener('visibilitychange', onVisible);

  return () => {
    if (frame) cancelAnimationFrame(frame);
    observer.disconnect();
    pageObserver.disconnect();
    window.removeEventListener('popstate', idleApply);
    window.removeEventListener('meetifyy:system-bars-reset', onNativeReset);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

export default installSystemBars;
