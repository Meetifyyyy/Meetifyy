import { Capacitor, registerPlugin, SystemBars, SystemBarsStyle } from '@capacitor/core';

/**
 * The native half of the phone's system bars.
 *
 * The bars are transparent for the life of the app and the WebView is laid out
 * beneath them, so the PAGE paints every pixel of them (see
 * `src/mobile/installSystemBars.js`, which decides what colour, and
 * `SystemUiPlugin.java`, which explains why). What only the native side can do
 * is small, and this is all of it:
 *
 *   - `setIcons`      whether each bar's clock/battery/buttons are drawn light or
 *                     dark. The platform offers no other way to set this.
 *   - `persistTheme`  remembers the theme so the next cold start's splash and
 *                     window are drawn in it before any page exists.
 *   - `getInsets`     how tall the bars are, so the page can keep its controls
 *                     clear of them before the first paint.
 *
 * Nothing here paints a bar. Every call is fire-and-forget, and every failure
 * is swallowed: on the web neither plugin exists, on iOS only Capacitor's own
 * exists, and a bar whose icons keep their previous appearance is a cosmetic
 * problem. Throwing would take down whatever called it, which is a theme change.
 *
 * `SystemBars` (Capacitor's) is still used on iOS, where there is no `SystemUi`
 * and the status bar still needs to know whether to draw its clock light or dark.
 *
 * WHERE THE THEME COLOUR COMES FROM
 * `--color-nav-surface` is what the app's own bottom navigation is painted with.
 * The window colour is read from it so the frames before the WebView draws match
 * the app's chrome, and it follows the palette without anyone remembering it
 * exists. Not `--color-bg-white`: that is the CARD surface (#ffffff / #202020),
 * which made the window mid-grey on dark.
 */

const SystemUi = registerPlugin('SystemUi');

/**
 * Resolves a CSS colour to something Android's `Color.parseColor` accepts.
 *
 * `getComputedStyle` hands back whatever the stylesheet wrote — `#202020`, or
 * `rgb(32, 32, 32)` once a browser has normalised it. Android reads hex and
 * named colours only, so an `rgb()` string is rejected by the plugin and the
 * bars keep their old colour. Converting here keeps that knowledge next to the
 * thing that produced it.
 */
export function toHexColor(value) {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    // #abc -> #aabbcc, which Android accepts and the 3-digit form it does not.
    const [, r, g, b] = trimmed;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  if (/^#[0-9a-f]{6}$/i.test(trimmed) || /^#[0-9a-f]{8}$/i.test(trimmed)) return trimmed;

  const rgb = trimmed.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i);
  if (rgb) {
    const hex = rgb
      .slice(1, 4)
      .map((n) => Math.min(255, Number.parseInt(n, 10)).toString(16).padStart(2, '0'))
      .join('');
    return `#${hex}`;
  }

  return null;
}

/**
 * True when a colour is dark enough that light icons are needed over it.
 *
 * Relative luminance rather than a simple average: the eye is far more
 * sensitive to green than to blue, so averaging calls a saturated blue light
 * when it reads as dark, and the icons come out invisible.
 *
 * THE ALPHA IS SKIPPED, NOT READ AS RED
 * Android's eight-digit form is `#AARRGGBB`, so the first pair after the hash
 * is opacity. Slicing from index 1 regardless treated that pair as red and
 * shifted every channel by one: `#00FFFFFF`, a fully transparent white, came
 * out as r=0 g=255 b=255 and only happened to land on the right answer. It
 * matters now that a screen can ask for transparent bars — the RGB half of
 * that colour is the only thing left saying whether the clock should be drawn
 * light or dark, so it has to be read from the right place.
 */
export function needsLightIcons(hex) {
  const normalized = toHexColor(hex);
  if (!normalized) return false;

  // 9 = '#' + 8 digits, i.e. the #AARRGGBB form; start past the alpha pair.
  const rgb = normalized.length === 9 ? normalized.slice(3) : normalized.slice(1);

  const r = Number.parseInt(rgb.slice(0, 2), 16);
  const g = Number.parseInt(rgb.slice(2, 4), 16);
  const b = Number.parseInt(rgb.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  return luminance < 0.5;
}

/** Bridge calls are retried because the first one can run before the bridge is wired. */
async function callWithRetry(call) {
  /*
   * This module is installed at module scope and fires on the next frame,
   * which on a cold start is earlier than Capacitor has finished wiring up its
   * plugins. The call rejected, the catch swallowed it, and the bars kept their
   * launch appearance for the whole session — measured on a device, while
   * calling the same method by hand a moment later worked perfectly.
   *
   * Three attempts over ~700ms covers bridge startup without being a poll.
   * Failing after that is genuinely "this platform has no SystemUi", which is
   * iOS and the web preview, and is not worth shouting about.
   */
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await call();
    } catch {
      if (attempt === 2) return null;
      await new Promise((r) => setTimeout(r, 150 + attempt * 200));
    }
  }
  return null;
}

export function createCapacitorSystemBars({ getComputed } = {}) {
  const read =
    getComputed ??
    (() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue('--color-nav-surface')
        .trim());

  // The last payloads sent, so a re-sample that finds the same colours (most
  // of them) costs no bridge call.
  let lastIcons = '';
  let lastTheme = '';
  let lastWindowColor = '';

  return {
    /**
     * Sets the bars' icon appearance. `status` and `navigation` are `true` for
     * LIGHT icons (drawn over a dark surface).
     */
    async setIcons({ status, navigation }) {
      const key = `${status ? 1 : 0}${navigation ? 1 : 0}`;
      if (key === lastIcons) return;
      lastIcons = key;

      await callWithRetry(() => SystemUi.setIcons({
        statusLightIcons: !!status,
        navLightIcons: !!navigation,
      }));

      // iOS only: it has no `SystemUi`, and its status bar takes a style rather
      // than an appearance flag. On Android `SystemUi` above already did this,
      // and Capacitor's `setStyle` would repaint the bar's background too.
      if (Capacitor.getPlatform() !== 'ios') return;
      try {
        await SystemBars.setStyle({ style: status ? SystemBarsStyle.Dark : SystemBarsStyle.Light });
      } catch {
        // Not every platform implements it.
      }
    },

    /**
     * Persists the theme so the next cold start's window and splash match it,
     * and gives the window the app's chrome colour for the frames before the
     * WebView draws. Does not touch the bars.
     */
    async persistTheme({ force = false } = {}) {
      const background = toHexColor(read());
      if (!background) return;

      let theme = 'light';
      let preferenceSet = false;
      try {
        if (typeof document !== 'undefined') {
          theme = document.documentElement.getAttribute('data-theme') || 'light';
        }
        if (typeof localStorage !== 'undefined') {
          preferenceSet = localStorage.getItem('theme_preference_set') === 'true';
        }
      } catch (_) {}

      const key = [background, theme, preferenceSet].join('|');
      if (!force && key === lastTheme) return;
      lastTheme = key;

      await callWithRetry(() => SystemUi.setColors({
        background,
        lightIcons: needsLightIcons(background),
        theme,
        preferenceSet,
      }));
    },

    /**
     * Keeps the window behind the WebView the colour of the page's bottom edge.
     * It shows only while the soft keyboard slides in (the WebView has already
     * shrunk; the keyboard has not yet arrived), where the theme's colour was a
     * white patch across a dark screen. See SystemUiPlugin.setWindowColor.
     */
    async setWindowColor(color) {
      const hex = toHexColor(color);
      if (!hex || hex === lastWindowColor) return;
      lastWindowColor = hex;
      await callWithRetry(() => SystemUi.setWindowColor({ color: hex }));
    },

    /** `{ top, bottom }` in CSS px, or null where the plugin does not exist. */
    async getInsets() {
      try {
        return await SystemUi.getInsets();
      } catch {
        return null;
      }
    },
  };
}

export default createCapacitorSystemBars;
