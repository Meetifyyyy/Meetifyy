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

  /**
   * Where the strip colours are written: a rule of their own, not <html>.
   *
   * Custom properties inherit, so writing one on <html>'s inline style restyled
   * every element on the page - measured on the I2208, 591 elements and 18-46ms
   * per sample, and a sample runs on every navigation and after every theme
   * switch. Only <html> and its two pseudo-elements read these, so each lives
   * in a rule that matches exactly the element that reads it (`--sys-window-bg`
   * is registered non-inheriting in mobile.css so its rule on <html> stops
   * there too). Changing a declaration in one of these rules restyles what the
   * rule matches and nothing else.
   */
  let stripStyle = null;
  const stripRules = (() => {
    try {
      const style = document.createElement('style');
      stripStyle = style;
      style.setAttribute('data-system-bars', '');
      document.head.appendChild(style);
      const sheet = style.sheet;
      const rule = (selector) => sheet.cssRules[sheet.insertRule(`${selector} {}`, sheet.cssRules.length)];
      // An attribute in each selector gives the engine something narrower than
      // a bare type selector to scope the restyle to when a rule changes.
      root.setAttribute('data-system-bars', '');
      return {
        '--sys-top-bg': rule('html[data-system-bars]::before'),
        '--sys-bottom-bg': rule('html[data-system-bars]::after'),
        '--sys-window-bg': rule('html[data-system-bars]'),
      };
    } catch (_) {
      return null;
    }
  })();

  let lastTop;
  let lastBottom;
  let lastWindow;
  const setStrip = (name, value, last) => {
    if (value === last) return last;
    const rule = stripRules && stripRules[name];
    if (rule) rule.style.setProperty(name, value);
    else root.style.setProperty(name, value);
    return value;
  };

  /**
   * Reads what the page paints at each edge and applies it.
   *
   * Runs inside an animation frame's callback, which is before that frame's
   * style, layout and paint — so a colour written here is the colour of the
   * very frame that shows the DOM change that prompted it.
   */
  /*
   * Moments when the page's edge is in motion and sampling it would capture a
   * transient, not the page:
   *
   *  - A pull-to-refresh on screen (`data-pull-active`, set by PullToRefresh).
   *    The gesture slides a full-width surface down from the top edge — white
   *    in the light theme — and sampling mid-pull painted the status bar white
   *    until the refresh settled, about a second later.
   *  - A scroll-through screen (Home, `data-bars-scroll-through`) with its
   *    chrome hidden, or with the chrome still sliding back. The strips are
   *    transparent there by CSS alone, in the frame the chrome hides; sampling
   *    while the header was mid-slide used to catch either the header or the
   *    feed and swap the bar's colour a beat later.
   *
   * During either, the strips keep the colours they had and the next settled
   * sample takes over. Nothing else changes: every other screen and moment
   * samples exactly as before.
   */
  const CHROME_SLIDE_MS = 320;
  let chromeWasHidden = false;
  let chromeShownAt = -Infinity;
  let afterSlide = 0;
  const edgeInMotion = () => {
    if (root.hasAttribute('data-pull-active')) return true;
    const hidden = root.hasAttribute('data-chrome-hidden');
    if (chromeWasHidden && !hidden) {
      chromeShownAt = performance.now();
      clearTimeout(afterSlide);
      // One sample once the slide back has finished.
      afterSlide = setTimeout(() => schedule(), CHROME_SLIDE_MS + 20);
    }
    chromeWasHidden = hidden;
    if (!root.hasAttribute('data-bars-scroll-through')) return false;
    // Holding keeps the colours of the last sample, and those belong to the
    // page and the bar requests they were sampled under. Leaving a scrolled
    // Profile for Home, the last sample still had Profile's cover-page request
    // (a see-through strip); held while Home's chrome slid back, the status bar
    // showed the feed underneath it for ~360ms. When either has changed since,
    // sample now.
    if (stripsBasis() !== sampledBasis) return false;
    return hidden || performance.now() - chromeShownAt < CHROME_SLIDE_MS;
  };
  // What the strips' colours were last sampled under (see edgeInMotion).
  const stripsBasis = () => [
    location.pathname,
    root.hasAttribute('data-collapsing-header'),
    root.getAttribute('data-bars'),
    root.getAttribute('data-navigation-bar'),
  ].join('|');
  let sampledBasis = null;

  const sample = () => {
    if (edgeInMotion()) {
      // Where the strips are transparent (chrome hidden on a scroll-through
      // screen) the icons sit on the page itself, so they follow the theme.
      if (root.hasAttribute('data-bars-scroll-through') && root.hasAttribute('data-chrome-hidden')
        && !root.hasAttribute('data-pull-active')) {
        // A screen's own hint still wins, as it does in the settled path below.
        // Profile is scroll-through AND sets light icons for its cover header;
        // taking the theme alone here sent dark icons whenever the chrome hid
        // and light ones when it came back, so the status icons flickered
        // with every scroll direction change.
        const darkTheme = root.getAttribute('data-theme') === 'dark';
        const fromHint = (hint) => (hint === 'light' ? true : hint === 'dark' ? false : darkTheme);
        systemBars.setIcons?.({
          status: fromHint(root.getAttribute('data-status-bar-icons')),
          navigation: fromHint(root.getAttribute('data-navigation-bar-icons')),
        });
      }
      return;
    }
    const topTransparent =
      root.hasAttribute('data-collapsing-header') || root.getAttribute('data-bars') === 'transparent';
    const bottomTransparent = root.getAttribute('data-navigation-bar') === 'transparent';
    const dark = root.getAttribute('data-theme') === 'dark';

    const chrome = readThemeChrome();
    const edges = (readEdges && readEdges()) || {};
    const top = toHexColor(edges.top) || chrome;
    const bottom = toHexColor(edges.bottom) || chrome;

    sampledBasis = stripsBasis();
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
    systemBars.setWindowColor?.(toHexColor(edges.window) || bottom);
  };

  let frame = 0;
  let settle = 0;
  // The route the strips were last sampled on.
  let sampledPath = typeof location !== 'undefined' ? location.pathname : '';
  // When the route last changed. The new page's DOM usually lands a frame or
  // more after the URL does (route transitions, lazy chunks), so the first
  // sample can still read the page being left.
  let routeChangedAt = -Infinity;
  const ROUTE_SETTLE_MS = 600;
  const run = () => {
    frame = 0;
    if (location.pathname !== sampledPath) routeChangedAt = performance.now();
    sampledPath = location.pathname;
    sample();
  };
  /** At most one sample per frame, in the frame the change lands in. */
  const schedule = () => {
    // Sampling reads computed styles and elementsFromPoint, each a forced
    // layout. During text entry the page's edge colours do not change, and the
    // keyboard is animating, so wait: a keyboard-hidden event samples afterwards.
    // Unless the ROUTE changed: Home's search field hands off to /search with
    // the keyboard up, and the status strip kept Home's colour (the blue page
    // gradient) over Search's white header until the keyboard closed.
    // The same holds for a short while after the route changed: closing Search
    // with the keyboard up, the route-change sample still read Search's page,
    // and Home's DOM arriving a frame later was skipped, so the status bar kept
    // Search's colour until the keyboard had finished closing.
    if (root.hasAttribute('data-text-entry') && location.pathname === sampledPath
      && performance.now() - routeChangedAt > ROUTE_SETTLE_MS) return;
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

  sampledPath = location.pathname;
  sample();

  // The side insets follow `data-bars-sides` at once, not on the settled
  // sample: the screen asking for them has just mounted and is laid out for
  // the full width.
  let sidesDrawn = null;
  const syncSides = () => {
    const drawn = root.hasAttribute('data-bars-sides');
    if (drawn === sidesDrawn) return;
    sidesDrawn = drawn;
    systemBars.setSides?.(drawn);
  };
  syncSides();
  new MutationObserver(syncSides).observe(root, { attributes: true, attributeFilter: ['data-bars-sides'] });

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
      // White page gradient on Messages, Communities, Search, unverified Campus (global.css).
      'data-white-surface',
      // The header and the bottom navigation slide away on scroll; the page
      // behind them is what the strips continue once they have.
      'data-chrome-hidden',
      'data-no-bottom-nav',
      // A pull-to-refresh starting and settling (see edgeInMotion).
      'data-pull-active',
      'data-bars-scroll-through',
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
  window.addEventListener('meetifyy:text-entry-end', () => setTimeout(scheduleWithSettle, 50));
  window.addEventListener('resize', schedule);
  /**
   * While a page scrolls, and once it has stopped: what sits at the top and
   * bottom edge of a long page changes as it scrolls (Campus's red banner
   * leaving the status bar, a sheet reaching the navigation bar), and nothing in
   * the DOM changes when it does. Sampling only after the scroll had been quiet
   * for 160ms left the bar in the old colour for the whole scroll and then
   * snapped it, so a sample also runs during the scroll, at most every
   * SCROLL_SAMPLE_MS, and one more follows the last scroll event.
   */
  const SCROLL_SAMPLE_MS = 90;
  let scrollTimer = 0;
  let lastScrollSample = -Infinity;
  const onScroll = () => {
    clearTimeout(scrollTimer);
    const now = performance.now();
    if (now - lastScrollSample >= SCROLL_SAMPLE_MS) {
      lastScrollSample = now;
      schedule();
    }
    scrollTimer = setTimeout(schedule, 160);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  // Slides and fades that end without any DOM change. Not those inside a
  // keyboard dock or an element that opts out (`data-bars-transition-ignore`,
  // e.g. the post composer): their transitions run with the keyboard and never
  // change what is at the screen's edges, and each sample is a forced layout
  // plus bridge calls in the middle of that motion.
  const onTransitionEnd = (e) => {
    const t = e.target;
    if (t instanceof Element && t.closest('[data-keyboard-dock], [data-bars-transition-ignore]')) return;
    schedule();
  };
  document.addEventListener('transitionend', onTransitionEnd, true);
  document.addEventListener('animationend', onTransitionEnd, true);
  // From MainActivity once the splash is removed.
  window.addEventListener('meetifyy:system-bars-reset', scheduleWithSettle);
  // An overlay outside #root (the media viewer) beginning to leave.
  window.addEventListener('meetifyy:system-bars-resample', scheduleWithSettle);

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
    stripStyle?.remove();
    root.removeAttribute('data-system-bars');
    clearTimeout(settle);
    clearTimeout(afterSlide);
    observer.disconnect();
    pageObserver.disconnect();
    window.removeEventListener('popstate', scheduleWithSettle);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('scroll', onScroll);
    clearTimeout(scrollTimer);
    document.removeEventListener('transitionend', onTransitionEnd, true);
    document.removeEventListener('animationend', onTransitionEnd, true);
    window.removeEventListener('meetifyy:system-bars-reset', scheduleWithSettle);
    window.removeEventListener('meetifyy:system-bars-resample', scheduleWithSettle);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

export default installSystemBars;
