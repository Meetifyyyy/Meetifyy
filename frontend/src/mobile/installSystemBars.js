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
  const apply = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = 0;
      systemBars.apply();
    });
  };

  apply();

  const observer = new MutationObserver(apply);
  observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });

  /**
   * Android can reset the bars when the app returns to the foreground, and a
   * theme change made in the OS while the app was away arrives as a resume
   * rather than as a DOM change.
   */
  const onVisible = () => {
    if (document.visibilityState === 'visible') apply();
  };
  document.addEventListener('visibilitychange', onVisible);

  return () => {
    if (frame) cancelAnimationFrame(frame);
    observer.disconnect();
    document.removeEventListener('visibilitychange', onVisible);
  };
}

export default installSystemBars;
