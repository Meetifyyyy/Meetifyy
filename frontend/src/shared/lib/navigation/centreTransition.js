/**
 * The centre-opening effect, about the middle of the screen. Opening, the page
 * being left grows and dissolves to show the new page; closing, the page being
 * closed shrinks and dissolves to show the one it was opened from. The two are
 * opposites: opening moves towards you, closing away.
 *
 * THE LIVE PAGE DOES NOT MOVE. All of the motion is the screenshot's, one GPU
 * texture scaled and faded per frame; the WebView is left at rest so its
 * renderer can spend the motion building the page being opened. The first
 * version scaled the WebView itself on open (X's new page settles from 1.15x),
 * and that was the part that felt janky: Chromium re-rasters a layer whenever
 * the scale it is shown at changes at all, outside CSS animations
 * (cc PictureLayerImpl::ShouldAdjustRasterScale), and a native view transform
 * is not one. `liveScale` turns that back on for comparing on a device.
 *
 * Only the closing post may be smaller than the screen. It is the picture, drawn
 * over the live page it returns to, so round it is that page itself. A page
 * BENEATH shrunk (X's goes to about 0.95) shows what is round it instead: the
 * new page's own background when opening, the window's colour when closing. On
 * the Campus page that was a band of another page's colour on three sides, both
 * ways. So the page beneath and the opening picture are never below 1.
 *
 * THE PIVOT is X's, measured from its own post screen on the I2208 (a 60 fps
 * screen recording, each frame fitted for scale and opacity, with the pivot
 * tried at the centre, the tap point and the top edge; only the centre fit).
 *
 * THE TIMING is not the recording's (a phone screen recording only has the
 * frames it managed to capture, and X's own curve came out looking like it held
 * still and then lunged). It was chosen by working out the opacity of every
 * frame at 60 fps for each candidate and taking the one with the smallest jump
 * between two frames, since that jump is what reads as a pop. Material's
 * standard easing (0.2, 0, 0, 1), the obvious choice, is the worst of them: it
 * is so front-loaded that the dissolve was over in four frames (a jump of 0.44
 * in one). These two curves spread it across about nine, with a jump of 0.16.
 *
 * THE DISSOLVE of one page into the other is a smoothstep, zero slope where it
 * starts and where it ends, so it neither pops in the first frames nor leaves a
 * faint ghost in the last.
 *
 * On close the page being left is drawn over the live feed, so while it is
 * still visible its text sits on top of the feed's like a stamp. It is
 * therefore gone before the end of the motion (`fadeEnd`), and the elements
 * that repeat in the feed go first (`PAGE_FADE_EARLY`).
 *
 * One number, the pose, drives all of it (SlidePageEffect and CentrePageEffect
 * both read the shell's single `pose`): 0 with the new page not yet there, 1
 * with it covering the screen. This file is only the numbers and the arguments
 * the shell is given; how it is drawn is CentrePageEffect.java.
 */

export const CENTRE_EFFECT = 'centre';

/**
 * Durations in ms; `curve` is a cubic-bezier. `pictureScale` is the size the
 * page being left (the screenshot) has reached by the end: grown when opening,
 * shrunk when closing. `liveScale` is the
 * size the new page starts at when opening, scaling the live WebView: 1 leaves
 * it alone, which is the point (see THE LIVE PAGE DOES NOT MOVE). Only the
 * closing picture is ever below 1.
 *
 * `fadeEnd` is how far through the motion (0-1) the page that is being covered
 * or left has finished dissolving. On close `earlyFadeEnd` is the same for the
 * elements marked `PAGE_FADE_EARLY`, which dissolve sooner than the rest of the
 * page: the four action buttons of a post, which would otherwise ghost over the
 * identical row in the feed.
 */
export const CENTRE_MOTION = Object.freeze({
  // Opening leans towards a soft landing, closing is an even ease in and out.
  open: Object.freeze({
    duration: 300,
    curve: Object.freeze({ x1: 0.3, y1: 0, x2: 0.4, y2: 1 }),
    fadeEnd: 0.85,
    pictureScale: 1.1,
    // 1 leaves the live page alone; X's own is 1.15.
    liveScale: 1,
  }),
  close: Object.freeze({
    duration: 300,
    curve: Object.freeze({ x1: 0.4, y1: 0, x2: 0.6, y2: 1 }),
    fadeEnd: 0.85,
    earlyFadeEnd: 0.35,
    pictureScale: 0.9,
  }),
});

/**
 * Spread this onto an element that should dissolve sooner than the rest of its
 * page when the page closes with the centre opening (see `measureFadeEarly`).
 * The attribute is inert everywhere else, the website included.
 */
export const PAGE_FADE_EARLY = Object.freeze({ 'data-page-fade-early': '' });

/**
 * A profile or a community can show a few posts at once, four buttons each; more
 * than this would be a page marking everything, and the shell takes the first few.
 */
const MAX_EARLY_RECTS = 16;

/**
 * Where the elements marked `PAGE_FADE_EARLY` are on screen right now, in CSS
 * px from the top left of the window. Taken just before the page is pictured,
 * because by the time the motion plays the page is no longer there to ask:
 * the shell dissolves those rectangles of the picture early.
 *
 * Elements that are not on screen (scrolled away, hidden) are left out.
 */
export function measureFadeEarly(root = typeof document !== 'undefined' ? document : null) {
  if (!root) return [];
  const rects = [];
  for (const element of root.querySelectorAll('[data-page-fade-early]')) {
    const box = element.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) continue;
    if (box.bottom <= 0 || box.right <= 0) continue;
    if (box.top >= window.innerHeight || box.left >= window.innerWidth) continue;
    rects.push({ x: box.left, y: box.top, width: box.width, height: box.height });
    if (rects.length === MAX_EARLY_RECTS) break;
  }
  return rects;
}

/**
 * What the shell's `play` is given. `fadeEarly` is what `measureFadeEarly`
 * returned as the page was pictured; only a close uses it.
 */
export function centrePlayArgs(direction, _dark, fadeEarly) {
  const timing = CENTRE_MOTION[direction];
  const args = {
    effect: CENTRE_EFFECT,
    direction,
    duration: timing.duration,
    curve: { ...timing.curve },
    pictureScale: timing.pictureScale,
    fadeEnd: timing.fadeEnd,
  };
  if (direction === 'open') args.liveScale = timing.liveScale;
  if (direction === 'close') {
    args.earlyFadeEnd = timing.earlyFadeEnd;
    args.fadeEarly = Array.isArray(fadeEarly) ? fadeEarly : [];
  }
  return args;
}
