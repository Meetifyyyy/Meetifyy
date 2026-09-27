/**
 * Keeps a phone on its side in the mobile layout — installed app only.
 *
 * The layout switches at 768px of WIDTH, and a phone in landscape is wider
 * than that (about 800-930 CSS px), so rotating it brought up the desktop
 * layout. What actually distinguishes a phone on its side from a tablet or a
 * laptop is its HEIGHT: under 500px, where tablets in landscape start at 600.
 *
 * So, in the app's stylesheets (a PostCSS plugin in vite.mobile.config.js) and
 * in every `matchMedia` call (installed in main.jsx), a media query is
 * rewritten so that:
 *
 *   (max-width: N)  with N >= 768  also matches at (max-device-height: 500px)
 *   (min-width: N)  with N >= 769  additionally requires (min-device-height: 501px)
 *
 * DEVICE height, not viewport height: the viewport shrinks when the keyboard
 * opens, which would flip a tablet in landscape to the phone layout mid-typing.
 * The screen's own height does not change with the keyboard.
 *
 * A short landscape screen therefore takes every "small screen" branch and none
 * of the "large screen" ones; anything 501px or taller is untouched, so
 * portrait phones, tablets, and every desktop size behave exactly as before.
 * The website never loads this.
 *
 * Plain ES module with no imports: it runs in Node (the PostCSS plugin) as well
 * as in the app.
 */

export const LANDSCAPE_PHONE_MAX_HEIGHT = 500;
const MOBILE_MAX = 768;

const MAX_W = /\(\s*max-width\s*:\s*(\d+(?:\.\d+)?)px\s*\)/;
const MIN_W = /\(\s*min-width\s*:\s*(\d+(?:\.\d+)?)px\s*\)/;

function adaptOne(query) {
  let q = query.trim();
  const min = q.match(MIN_W);
  if (min && Number(min[1]) > MOBILE_MAX) {
    q = `${q} and (min-device-height: ${LANDSCAPE_PHONE_MAX_HEIGHT + 1}px)`;
  }
  const max = q.match(MAX_W);
  if (max && Number(max[1]) >= MOBILE_MAX) {
    const alt = q.replace(MAX_W, `(max-device-height: ${LANDSCAPE_PHONE_MAX_HEIGHT}px)`);
    return `${q}, ${alt}`;
  }
  return q;
}

/** Rewrites a media query list (the part after `@media`, or a matchMedia argument). */
export function adaptMediaQuery(list) {
  if (typeof list !== 'string' || !/(min|max)-width/.test(list)) return list;
  // Idempotent: PostCSS re-visits a rule after a plugin changes it, and a
  // second pass appending again would never settle (a build that hung at
  // "transforming"). Already-adapted lists are returned as they are.
  if (list.includes('device-height')) return list;
  return list.split(',').map(adaptOne).join(', ');
}

/** PostCSS plugin applying `adaptMediaQuery` to every `@media` rule. */
export function landscapePhoneMediaPostcss() {
  return {
    postcssPlugin: 'meetifyy-landscape-phone-media',
    AtRule: {
      media(rule) {
        const next = adaptMediaQuery(rule.params);
        if (next !== rule.params) rule.params = next;
      },
    },
  };
}
landscapePhoneMediaPostcss.postcss = true;

/** Routes every `window.matchMedia` query through the same rule. */
export function installLandscapePhoneMatchMedia() {
  if (typeof window === 'undefined' || !window.matchMedia) return;
  const original = window.matchMedia.bind(window);
  window.matchMedia = (query) => original(adaptMediaQuery(query));
}
