import { toHexColor, needsLightIcons } from '../platform/capacitor/systemBars';

/**
 * Keeps the phone's system bars continuous with the page.
 *
 * ONE OWNER FOR THE PIXELS
 * The bars are transparent and the WebView is laid out beneath them, so the page
 * paints them: a fixed strip at the top (`html::before`) and one at the bottom
 * (`html::after`), see `mobile.css`. Each takes its colour from a custom
 * property this module writes, `--sys-top-bg` and `--sys-bottom-bg`.
 *
 * That is what fixes the flicker. The bars used to be painted natively, with a
 * colour the page measured about itself and sent across the bridge after an idle
 * callback, so on every navigation two systems changed a few frames apart —
 * 70 ms to 500 ms on a device — and the bar showed the previous page's colour in
 * between. Now the strip's colour is set in the same animation frame as the DOM
 * change that caused it, before that frame paints, by the same engine that draws
 * the page. There is no second system to fall behind.
 *
 * WHAT THE BRIDGE STILL CARRIES
 * Only the icons' light/dark appearance (the platform offers no way to draw
 * those from a page) and, rarely, the theme for the next cold start.
 *
 * WHY IT WATCHES THE DOM RATHER THAN SUBSCRIBING TO THE THEME
 * `ThemeContext` is shared with the website, and the website has no system bars
 * to colour. Reaching into it to add a mobile-only callback would put a
 * platform concern into code the web runs too, which is the one thing the
 * `src/mobile/` boundary exists to prevent. `data-theme` on `<html>` is the
 * observable result of that context, and watching it needs nothing from the
 * shared layer at all.
 *
 * HOW A SCREEN OPTS OUT
 * A screen that draws its own imagery behind a bar sets an attribute on <html>
 * (see `useSystemBars`) and the strip gets out of the way:
 *
 *   data-bars="transparent"        the status bar is drawn over by the page
 *   data-collapsing-header         same, for cover pages (profile, community)
 *   data-navigation-bar="transparent"  the navigation bar is drawn over by the page
 *   data-bars-canvas               the document behind the screen takes its bottom colour
 *   data-status-bar-icons / data-navigation-bar-icons = "light" | "dark"
 *
 * The colour itself is read from the page (see `pageEdgeColors.js`), so it
 * follows the palette rather than duplicating it.
 */

/** Frames of quiet after the last DOM change before the final settling sample. */
const SETTLE_MS = 350;

const INSETS_KEY = 'meetifyy.insets';

export function installSystemBars(systemBars, { readEdges } = {}) {
  if (!systemBars || typeof document === 'undefined') return () => {};

  const root = document.documentElement;

  /**
   * The bars' heights, before anything paints.
   *
   * The native side publishes them as `--status-bar-inset` and
   * `--navigation-bar-inset`, but that arrives asynchronously, so the first
   * frame used to lay out with zero and jump when it landed. The last known
   * values are cached (the native side writes them on every change), so the
   * first frame is already right; the native value follows and corrects it.
   */
  const setInsets = (top, bottom) => {
    if (Number.isFinite(top) && root.style.getPropertyValue('--status-bar-inset') !== `${top}px`) {
      root.style.setProperty('--status-bar-inset', `${top}px`);
    }
    if (Number.isFinite(bottom) && root.style.getPropertyValue('--navigation-bar-inset') !== `${bottom}px`) {
      root.style.setProperty('--navigation-bar-inset', `${bottom}px`);
    }
  };
  try {
    if (!root.style.getPropertyValue('--status-bar-inset')) {
      const [top, bottom] = (localStorage.getItem(INSETS_KEY) || '').split(',').map(Number);
      if (Number.isFinite(top) && Number.isFinite(bottom)) setInsets(top, bottom);
    }
  } catch (_) {}
  systemBars.getInsets?.().then((insets) => {
    if (insets) setInsets(insets.top, insets.bottom);
  });

  /**
   * The theme's chrome colour, read once per theme.
   *
   * Reading a custom property through getComputedStyle forces a full style
   * recalculation, and `sample` runs on every DOM change, transition end and
   * resize. Measured on the I2208 while the post composer expanded and the
   * keyboard opened, these reads were ~42 ms of forced recalcs across the
   * gesture. The value depends only on `data-theme`, so it is cached by it.
   */
  let chromeTheme = null;
  let chromeColour = null;
  const readThemeChrome = () => {
    const theme = root.getAttribute('data-theme');
    if (theme !== chromeTheme || !chromeColour) {
      chromeTheme = theme;
      chromeColour = toHexColor(getComputedStyle(root).getPropertyValue('--color-nav-surface'));
    }
    return chromeColour;
  };

  let lastTop;
  let lastBottom;
  let lastWindow;
  const setStrip = (name, value, last) => {
    if (value === last) return last;
    root.style.setProperty(name, value);
    return value;
  };

  /**
   * Reads what the page paints at each edge and applies it.
   *
   * Runs inside an animation frame's callback, which is before that frame's
   * style, layout and paint — so a colour written here is the colour of the
   * very frame that shows the DOM change that prompted it.
   */
  const sample = () => {
    const topTransparent =
      root.hasAttribute('data-collapsing-header') || root.getAttribute('data-bars') === 'transparent';
    const bottomTransparent = root.getAttribute('data-navigation-bar') === 'transparent';
    const dark = root.getAttribute('data-theme') === 'dark';

    const chrome = readThemeChrome();
    const edges = (readEdges && readEdges()) || {};
    const top = toHexColor(edges.top) || chrome;
    const bottom = toHexColor(edges.bottom) || chrome;

    lastTop = setStrip('--sys-top-bg', topTransparent || !top ? 'transparent' : top, lastTop);
    // What the document behind a `canvas` screen is painted (see mobile.css).
    lastWindow = setStrip('--sys-window-bg', bottom || 'transparent', lastWindow);
    lastBottom = setStrip('--sys-bottom-bg', bottomTransparent || !bottom ? 'transparent' : bottom, lastBottom);

    // Icons follow whatever is under them: the page's own edge colour, or —
    // where the page draws behind the bar — the screen's hint, or the theme.
    const iconsFor = (transparent, hint, colour) => {
      if (hint === 'light') return true;
      if (hint === 'dark') return false;
      if (transparent || !colour) return dark;
      return needsLightIcons(colour);
    };
    systemBars.setIcons?.({
      status: iconsFor(topTransparent, root.getAttribute('data-status-bar-icons'), top),
      navigation: iconsFor(bottomTransparent, root.getAttribute('data-navigation-bar-icons'), bottom),
    });
    // Handed the cached colour so it does not force its own style recalc.
    systemBars.persistTheme?.({ background: chrome });
    // The window behind the WebView follows the page's bottom edge even where
    // the page draws behind the bar (there `bottom` is still what it paints).
    systemBars.setWindowColor?.(bottom);
  };

  let frame = 0;
  let settle = 0;
  const run = () => {
    frame = 0;
    sample();
  };
  /** At most one sample per frame, in the frame the change lands in. */
  const schedule = () => {
    // Sampling reads computed styles and elementsFromPoint, each a forced
    // layout. During text entry the page's edge colours do not change, and the
    // keyboard is animating, so wait: a keyboard-hidden event samples afterwards.
    if (root.hasAttribute('data-text-entry')) return;
    if (!frame) frame = requestAnimationFrame(run);
  };
  /**
   * The same, plus one more once things have stopped moving: a transition that
   * has no end event, an image that sized a header, a lazily loaded font.
   */
  const scheduleWithSettle = () => {
    schedule();
    clearTimeout(settle);
    settle = setTimeout(schedule, SETTLE_MS);
  };

  sample();

  const observer = new MutationObserver(scheduleWithSettle);
  observer.observe(root, {
    attributes: true,
    attributeFilter: [
      'data-theme',
      'data-bars',
      'data-status-bar-icons',
      'data-navigation-bar',
      'data-navigation-bar-icons',
      'data-collapsing-header',
      // The header and the bottom navigation slide away on scroll; the page
      // behind them is what the strips continue once they have.
      'data-chrome-hidden',
      'data-no-bottom-nav',
    ],
  });

  /**
   * Page changes. Each bar follows the colour at the page's edge, which changes
   * on navigation, when a lazily loaded route arrives, and when data replaces a
   * loading state — all of which are DOM changes under #root.
   */
  const appRoot = document.getElementById('root');
  const pageObserver = new MutationObserver(scheduleWithSettle);
  if (appRoot) pageObserver.observe(appRoot, { childList: true, subtree: true });

  window.addEventListener('popstate', scheduleWithSettle);
  window.addEventListener('meetifyy:keyboard-hidden', () => setTimeout(scheduleWithSettle, 50));
  window.addEventListener('resize', schedule);
  /**
   * Once a scroll has stopped: what sits at the bottom edge of a long page
   * changes as it scrolls, and nothing in the DOM changes when it does. One
   * sample after the scroll settles, never one per frame of it.
   */
  let scrollTimer = 0;
  const onScroll = () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(schedule, 160);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  // Slides and fades that end without any DOM change.
  document.addEventListener('transitionend', schedule, true);
  document.addEventListener('animationend', schedule, true);
  // From MainActivity once the splash is removed.
  window.addEventListener('meetifyy:system-bars-reset', scheduleWithSettle);

  /**
   * A theme change made in the OS while the app was away arrives as a resume
   * rather than as a DOM change.
   */
  const onVisible = () => {
    if (document.visibilityState === 'visible') scheduleWithSettle();
  };
  document.addEventListener('visibilitychange', onVisible);

  return () => {
    if (frame) cancelAnimationFrame(frame);
    clearTimeout(settle);
    observer.disconnect();
    pageObserver.disconnect();
    window.removeEventListener('popstate', scheduleWithSettle);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('scroll', onScroll);
    clearTimeout(scrollTimer);
    document.removeEventListener('transitionend', schedule, true);
    document.removeEventListener('animationend', schedule, true);
    window.removeEventListener('meetifyy:system-bars-reset', scheduleWithSettle);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

export default installSystemBars;
