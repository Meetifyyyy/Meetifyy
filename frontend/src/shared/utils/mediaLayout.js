/**
 * Media sizing from real dimensions — one policy for every surface that lays
 * out a set of images and videos (post cards, the composer preview, and any
 * future gallery).
 *
 * WHY THIS IS ARITHMETIC AND NOT MEASUREMENT
 * Every upload records the file's pixel size (mediaPipeline sends it with the
 * presigned-URL request and the posts query returns it), so the shape of each
 * item is known before a single byte of it loads. Sizing from that, instead of
 * from the loaded element, is what makes the layout final on its first frame:
 * nothing waits for `onLoad`, and nothing moves when it fires.
 *
 * The outputs are ratios of the container's width, not pixels. The CSS turns
 * them into lengths with container-query units (`cqw`), so there is no
 * ResizeObserver, no measuring pass, and no frame where the width is unknown.
 */

/** Tallest frame shown in a card (3:5). Taller media is cropped to it. */
export const FRAME_ASPECT_MIN = 0.6;
/** Widest frame shown in a card (~2.2:1). Wider media is cropped to it. */
export const FRAME_ASPECT_MAX = 2.2;

/**
 * Largest share of the row one item of a carousel may take. The rest is the
 * next item showing at the edge, which is what tells people the row scrolls.
 */
export const CAROUSEL_PEEK_MAX = 0.92;
/** Row height bounds, as fractions of the container width. */
// The floor is exactly what the widest frame needs to fit the peek width, so a
// panorama leading the row is shown whole rather than capped.
export const CAROUSEL_HEIGHT_MIN = CAROUSEL_PEEK_MAX / FRAME_ASPECT_MAX;
export const CAROUSEL_HEIGHT_MAX = 1.2;

/** Shape assumed for an item whose size is not known (legacy rows only). */
export const FALLBACK_ASPECT = 1;

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function positive(n) {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * The width/height ratio an item declares, or null when it declares none.
 * Accepts every field name the feed, the composer and older rows have used.
 */
export function aspectOf(item) {
  if (!item || typeof item !== 'object') return null;
  const direct = positive(item.aspectRatio) ?? positive(item.raw?.aspectRatio);
  if (direct) return direct;
  const w = positive(item.width) ?? positive(item.raw?.width) ?? positive(item.originalWidth);
  const h = positive(item.height) ?? positive(item.raw?.height) ?? positive(item.originalHeight);
  return w && h ? w / h : null;
}

/**
 * The frame an item is drawn in. Within bounds the frame IS the media's shape,
 * so it is shown whole with no crop and no bars. Only a panorama or a very tall
 * screenshot is cropped, to the nearest bound — the viewer still shows it whole.
 */
export function frameFor(aspect) {
  const known = positive(aspect);
  const a = known ?? FALLBACK_ASPECT;
  const frame = clamp(a, FRAME_ASPECT_MIN, FRAME_ASPECT_MAX);
  return { aspect: frame, crop: Math.abs(frame - a) > 0.001, known: Boolean(known) };
}

/**
 * The height of a carousel row, as a fraction of its container's width.
 *
 * Every tile shares this one height and takes its width from its own shape
 * (height × aspect), so the set reads as one row of differently shaped media,
 * each shown whole: no bars, no crop. The height is the tallest that still lets
 * the WIDEST item fit within the peek width; anything narrower is then
 * narrower still and leaves room for the next tile at the edge.
 *
 * One height for the whole row also keeps the card's height independent of
 * which item is in view, so swiping never resizes the card.
 *
 * Only known shapes count. If none are known the row is sized for squares, and
 * it keeps that height: a size learnt later changes that tile's width
 * (sideways, inside the scroller), never the row's height (the page).
 */
export function carouselHeightRatio(aspects) {
  const known = aspects.map(positive).filter(Boolean).map((a) => frameFor(a).aspect);
  const widest = known.length ? Math.max(...known) : FALLBACK_ASPECT;
  return clamp(CAROUSEL_PEEK_MAX / widest, CAROUSEL_HEIGHT_MIN, CAROUSEL_HEIGHT_MAX);
}

/**
 * Full layout for a horizontal row of media.
 *
 * @param {(number|null)[]} aspects width/height per item, null when unknown
 * @param {number} [heightRatio] a row height already fixed for this set
 * @returns {{ heightRatio: number, items: { aspect: number, crop: boolean, known: boolean }[] }}
 *   Each item's width is `heightRatio × aspect` of the container. `crop` marks
 *   only the extreme shapes `frameFor` clamps.
 */
export function carouselLayout(aspects, heightRatio = carouselHeightRatio(aspects)) {
  return { heightRatio, items: aspects.map((a) => frameFor(a)) };
}
