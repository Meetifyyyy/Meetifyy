import campusHero from '@assets/images/campus_hero.webp';

/**
 * The join screen's hero is bundled, but a 1350px webp still has to be decoded
 * before it can paint, and a decode started by a throwaway `Image` is dropped
 * with it (Android WebView does this under memory pressure). Holding the one
 * element at module level keeps the decoded bitmap alive for the real <img>,
 * which then paints in its first frame instead of popping in afterwards.
 *
 * Idempotent: safe to call from the post-sign-in warm-up and again when the
 * join flow mounts.
 */
let held = null;

export function warmCampusHero() {
  if (held || typeof Image === 'undefined') return;
  held = new Image();
  held.src = campusHero;
  held.decode?.().catch(() => {});
}
