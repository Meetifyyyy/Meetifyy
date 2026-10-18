/**
 * Where the Edit cover sheet settles when a drag is released.
 *
 * Offsets are the sheet's downward translation in px: 0 is full screen,
 * `initial` is the height it opens at, anything past that is on its way out.
 * `visible` is how much of the sheet shows at `initial`; dismissing takes a
 * quarter of that, or a downward flick from the opening height, as the other
 * sheets do (useSheetDrag). A flick from full screen stops at the opening
 * height rather than closing in one go.
 *
 * Pure, so the gesture code only measures and paints.
 */
export const FLICK_SPEED = 0.5; // px per ms
export const DISMISS_FRACTION = 0.25;

export function resolveSheetSnap({ y, velocity = 0, initial, visible, from = 'initial' }) {
  const expandable = initial > 0;
  if (y > initial + visible * DISMISS_FRACTION) return 'close';
  if (velocity > FLICK_SPEED) {
    return from !== 'full' && y >= initial - 8 ? 'close' : 'initial';
  }
  if (!expandable) return 'initial';
  if (velocity < -FLICK_SPEED) return 'full';
  return y < initial / 2 ? 'full' : 'initial';
}

/** The offset for a snap name. */
export function snapOffset(snap, { initial, height }) {
  if (snap === 'full') return 0;
  if (snap === 'close') return height + 24;
  return initial;
}

/**
 * The opening offset: the sheet is laid out at full height (`height`), and
 * opens showing its content or the old cap (88% of the viewport, at least 1rem
 * below the top inset), whichever is shorter.
 */
export function initialOffset({ height, natural, viewport }) {
  const cap = Math.min(viewport * 0.88, height - 16);
  return Math.max(0, Math.round(height - Math.min(cap, natural)));
}
