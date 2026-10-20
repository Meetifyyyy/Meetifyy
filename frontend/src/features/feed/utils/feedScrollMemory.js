/**
 * What Home remembers so that coming back to it lands exactly where it was left.
 *
 * Two things are kept, because both used to be lost:
 *
 * - the scroll position, in sessionStorage (it survives a reload);
 * - the measured height of every post row, in memory for this page session.
 *
 * The heights matter more than they look. The feed is virtualised, so every row
 * that has not been measured is laid out from an ESTIMATE, and a row measured
 * for the first time above the viewport shifts the scroll position by the
 * difference. Re-entering Home after opening a post started the virtualizer
 * from nothing, so the rows just above the restored position were measured in
 * front of the user and each correction nudged the page: the "snap" after
 * going back. Seeded with the previous heights, those rows start at their real
 * size and nothing moves.
 */

export const FEED_SCROLL_KEY = 'meetifyy_feed_scrollY';

/** Rows remembered at most; a long scroll session cannot grow this forever. */
const MAX_REMEMBERED_ROWS = 1500;

let rememberedWidth = 0;
let rememberedSizes = new Map();

export function readSavedFeedScroll() {
  try {
    const raw = sessionStorage.getItem(FEED_SCROLL_KEY);
    const y = raw === null ? 0 : parseInt(raw, 10);
    return Number.isFinite(y) && y > 0 ? y : 0;
  } catch {
    return 0;
  }
}

export function saveFeedScroll(y) {
  try {
    sessionStorage.setItem(FEED_SCROLL_KEY, String(Math.max(0, Math.round(y))));
  } catch {
    // Storage can be unavailable (private mode); the position is then simply not kept.
  }
}

/**
 * Heights are only valid for the layout width they were measured at: a rotated
 * phone or a resized window re-flows every row, so a different width discards
 * them rather than seeding wrong values.
 */
export function rememberRowSizes(sizes, width) {
  if (!(sizes instanceof Map) || sizes.size === 0) return;
  if (width !== rememberedWidth) {
    rememberedWidth = width;
    rememberedSizes = new Map();
  }
  for (const [key, size] of sizes) {
    if (typeof size === 'number' && size > 0) rememberedSizes.set(key, size);
  }
  // Oldest first out: Map iterates in insertion order.
  while (rememberedSizes.size > MAX_REMEMBERED_ROWS) {
    rememberedSizes.delete(rememberedSizes.keys().next().value);
  }
}

/** Seed in the shape the virtualizer's `initialMeasurementsCache` expects. */
export function recallRowSizes(width) {
  if (width !== rememberedWidth) return [];
  return Array.from(rememberedSizes, ([key, size], index) => ({
    index,
    key,
    size,
    start: 0,
    end: size,
    lane: 0,
  }));
}

/** Test seam. */
export function forgetRowSizes() {
  rememberedWidth = 0;
  rememberedSizes = new Map();
}
