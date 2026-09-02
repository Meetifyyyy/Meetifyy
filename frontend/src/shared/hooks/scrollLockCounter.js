/**
 * The counted part of the scroll lock, separated from the DOM work so it can be
 * tested without a renderer.
 *
 * This is where the bug was. The lock used to be per-hook-instance: each
 * overlay captured the styles it found on mount and wrote them back on unmount.
 * With one overlay open that is correct. With two it is not, and this app opens
 * two routinely — a share sheet over a details panel, a confirm dialog over a
 * modal, the media viewer over a chat.
 *
 * The second overlay captured the FIRST one's `hidden` as though it were the
 * original, and whichever unmounted first wrote its own capture back. Closing
 * them in the order they were opened therefore restored the real originals
 * while the second overlay was still on screen, and the page behind it started
 * scrolling again.
 *
 * Counting removes the ordering question entirely: the first acquire engages,
 * the last release restores, and nothing in between can unlock the page.
 */

/**
 * @param {object} effects
 * @param {Function} effects.engage  Runs when the first holder acquires.
 * @param {Function} effects.release Runs when the last holder releases.
 */
export function createScrollLockCounter(effects) {
  let count = 0;

  return {
    acquire() {
      count += 1;
      if (count === 1) effects.engage();
      return count;
    },

    release() {
      /**
       * An extra release is ignored rather than allowed to go negative.
       *
       * A cleanup can run twice: StrictMode double-invokes effects in
       * development, and a fast unmount/remount can interleave them. Left
       * negative, the count would need two acquires before `count === 1` was
       * true again, so the NEXT overlay to open would not lock the page at all.
       * That failure is silent and shows up only as "scrolling works behind
       * this one modal, sometimes".
       *
       * Returning early also means `effects.release` runs on the 1 -> 0
       * transition and nowhere else, so the DOM restore is never replayed over
       * values it has already put back.
       */
      if (count === 0) return 0;

      count -= 1;
      if (count === 0) effects.release();
      return count;
    },

    get count() {
      return count;
    },
  };
}
