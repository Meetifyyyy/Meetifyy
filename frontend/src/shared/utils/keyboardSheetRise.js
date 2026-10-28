/**
 * Lets a dialog or sheet that makes room for the keyboard by LAYOUT slide up
 * with the keyboard instead of jumping.
 *
 * In the installed Android app the keyboard overlays the page, so a modal that
 * has to stay above it makes room the only way CSS can: it reads --kb-inset
 * (padding on its overlay, a smaller max-height). That is one layout change in
 * the frame the keyboard STARTS to move, so the sheet is already at its final
 * place while the keyboard is still at the bottom of the screen and the two
 * only meet ~250ms later. Closing the same in reverse: the sheet dropped to its
 * old place at once while the keyboard was still leaving.
 *
 * A FLIP animation fixes opening without the sheet knowing about it. The caller
 * (useKeyboardInset) measures the sheet BEFORE it publishes --kb-inset and again
 * AFTER; the difference is how far layout moved it, and `riseSheet` plays that
 * distance back as a `translate` from the old place to the new on the keyboard's
 * own duration, curve and head start, on the compositor. One implementation for
 * every modal; none of them needs markup or CSS of its own for it, and one that
 * does not move (a docked composer that lifts itself, a page that scrolls
 * instead) is left alone because its distance is ~0.
 *
 * A sheet on the bottom of the screen is usually also SHORTENED to fit above
 * the keyboard (its height capped by --kb-inset). Following its bottom edge
 * then made its top edge dip on the first frame and rise from there (measured
 * on the I2208: 41px down, then up), since the shortening lands at once. Such a
 * sheet follows its top edge instead, which is what the eye tracks. The gap
 * that opens between its bottom edge and the rising keyboard is filled with
 * the sheet's own colour for the length of the slide (a paint-only box-shadow,
 * no layout), and that fill ends behind the keyboard, which overlays the page.
 * Closing is the same slide the other way: the top edge glides down with the
 * keyboard instead of dropping at once, and the sheet's lengthened lower part
 * stays behind the keyboard as it leaves.
 *
 * `translate`, not `transform`: a sheet's entrance animation owns `transform`.
 */

/** Same curve as --kb-easing in mobile.css (the platform's IME interpolator). */
const IME_EASING = 'cubic-bezier(0.2, 0, 0, 1)';
/** A move smaller than this is rounding, not layout. */
const MIN_MOVE_PX = 2;

const running = new WeakMap();

/**
 * The element that should slide: the nearest `position: fixed` ancestor of the
 * focused field, or, when that is a full-screen scrim, the child of it that
 * holds the field (the sheet itself). null when the field is not in an overlay,
 * or sits in a composer that rises by its own transform.
 */
export function findKeyboardSheet(field = typeof document !== 'undefined' ? document.activeElement : null) {
  if (!field || field === document.body || typeof getComputedStyle !== 'function') return null;
  for (let node = field.parentElement; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
    if (node.hasAttribute?.('data-keyboard-dock')) return null;
    if (getComputedStyle(node).position !== 'fixed') continue;
    const rect = node.getBoundingClientRect();
    const fullScreen = rect.width >= window.innerWidth - 1 && rect.height >= window.innerHeight - 1;
    if (!fullScreen) return node;
    // The scrim: its child on the way down to the field is the sheet.
    let child = field;
    while (child.parentElement && child.parentElement !== node) child = child.parentElement;
    return child.parentElement === node ? child : null;
  }
  return null;
}

/** Where the sheet is now: the two edges the slide is worked out from. */
export function sheetEdges(sheet) {
  const { top, bottom } = sheet.getBoundingClientRect();
  return { top, bottom };
}

/**
 * How to slide the sheet that layout moved between two measurements.
 *
 * `travel`, positive = up: a sheet standing on the bottom of the screen (before
 * or after) is followed by its top edge; anything else by its middle, which is
 * what a centred dialog keeps.
 * `extend`: how far below its bottom edge the sheet's colour has to reach while
 * it slides, so no gap shows above the keyboard; the amount layout shortened
 * it by on the way up, 0 otherwise.
 *
 * @returns {{ travel: number, extend: number }}
 */
export function sheetSlide(before, after, viewportHeight = window.innerHeight) {
  const onBottom = before.bottom >= viewportHeight - 4 || after.bottom >= viewportHeight - 4;
  if (!onBottom) {
    return { travel: (before.top + before.bottom - after.top - after.bottom) / 2, extend: 0 };
  }
  const travel = before.top - after.top;
  const shortened = (before.bottom - after.bottom) - travel;
  return { travel, extend: travel > 0 && shortened >= MIN_MOVE_PX ? Math.ceil(shortened) : 0 };
}

/** The sheet's own colour reaching `extend` px below it, beside its own shadow. */
function extensionShadow(sheet, extend) {
  const style = getComputedStyle(sheet);
  const colour = style.backgroundColor;
  if (!colour || colour === 'transparent' || /rgba\(.*,\s*0\)$/.test(colour)) return null;
  const own = style.boxShadow && style.boxShadow !== 'none' ? `${style.boxShadow}, ` : '';
  return `${own}0 ${extend}px 0 0 ${colour}`;
}

/**
 * Plays a slide back into place.
 * @param {HTMLElement} sheet
 * @param {{travel: number, extend?: number}} slide  from sheetSlide
 * @param {{duration: number, delay?: number}} timing  the keyboard's, in ms
 *        (`delay` is negative: how far the keyboard has already moved)
 * @returns {boolean} whether an animation was started
 */
export function riseSheet(sheet, { travel, extend = 0 }, { duration, delay = 0 }) {
  if (!sheet || typeof sheet.animate !== 'function') return false;
  if (!(duration > 0) || Math.abs(travel) < MIN_MOVE_PX) return false;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;

  running.get(sheet)?.cancel();
  // Painted once for the slide and removed with it: by then it lies behind
  // the keyboard. Inline, restoring whatever inline value was there.
  const shadow = extend > 0 ? extensionShadow(sheet, extend) : null;
  const inlineShadow = sheet.style.boxShadow;
  if (shadow) sheet.style.boxShadow = shadow;
  const animation = sheet.animate(
    { translate: [`0 ${Math.round(travel)}px`, '0 0'] },
    { duration, delay, easing: IME_EASING, fill: 'none' },
  );
  running.set(sheet, animation);
  const done = () => {
    if (shadow) sheet.style.boxShadow = inlineShadow;
    if (running.get(sheet) === animation) running.delete(sheet);
  };
  animation.onfinish = done;
  animation.oncancel = done;
  return true;
}
