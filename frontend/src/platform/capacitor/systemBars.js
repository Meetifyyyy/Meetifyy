import { registerPlugin, SystemBars, SystemBarsStyle } from '@capacitor/core';

/**
 * Keeps the phone's status bar and navigation bar the same colour as the app.
 *
 * Two plugins, because neither does the whole job:
 *
 *   - `SystemBars` ships with Capacitor 8 and sets the bar STYLE, meaning
 *     whether their icons are drawn light or dark. It cannot set a background.
 *   - `SystemUi` is ours (`android/app/src/main/java/app/meetifyy/SystemUiPlugin.java`)
 *     and sets the background, which is what actually removes the white bands.
 *
 * The style call is kept even though `SystemUi` sets the appearance itself: on
 * iOS there is no `SystemUi`, and the status bar there still needs to know
 * whether to draw its clock light or dark.
 *
 * WHY THE COLOUR IS READ FROM CSS RATHER THAN HARD-CODED
 * `--color-nav-surface` is what the app's own bottom navigation is painted
 * with, so reading it is what guarantees the phone's navigation bar and the
 * app's bar directly above it are ONE strip rather than two nearly-matching
 * ones. Change the palette and this follows without anyone remembering it
 * exists.
 *
 * Not `--color-bg-white`: that is the CARD surface (#ffffff / #202020). Tying
 * the system bars to it made them mid-grey on dark, which reads as a third
 * surface floating between the app and the phone.
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
 */
export function needsLightIcons(hex) {
  const normalized = toHexColor(hex);
  if (!normalized) return false;

  const r = Number.parseInt(normalized.slice(1, 3), 16);
  const g = Number.parseInt(normalized.slice(3, 5), 16);
  const b = Number.parseInt(normalized.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  return luminance < 0.5;
}

export function createCapacitorSystemBars({ getComputed } = {}) {
  const read =
    getComputed ??
    (() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue('--color-nav-surface')
        .trim());

  return {
    /**
     * Pushes the app's current surface colour to the system bars.
     *
     * Every failure is swallowed: on web neither plugin exists, on iOS only one
     * does, and a bar that keeps its old colour is a cosmetic problem. Throwing
     * here would take down whatever called it, which is a theme change.
     */
    async apply() {
      const background = toHexColor(read());
      if (!background) return;

      const lightIcons = needsLightIcons(background);

      try {
        await SystemUi.setColors({ background, lightIcons });
      } catch {
        // No SystemUi here — iOS, or the web preview.
      }

      try {
        await SystemBars.setStyle({
          style: lightIcons ? SystemBarsStyle.Dark : SystemBarsStyle.Light,
        });
      } catch {
        // Not every platform implements it; the colour above is the part that
        // matters on Android.
      }
    },
  };
}

export default createCapacitorSystemBars;
