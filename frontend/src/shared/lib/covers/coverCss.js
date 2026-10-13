/**
 * Which stored cover strings may be painted as a CSS background.
 *
 * A gradient or pattern cover is stored as the CSS itself (see
 * `profileCovers.js`), so this is the one gate between a value someone wrote to
 * their profile and a `style={{ background }}` everyone else renders. Only
 * gradient functions, colours and plain lengths get through: no `url()`,
 * `image-set()`, `var()` or anything else that could make a viewer's browser
 * fetch something or read the page. The backend applies the same rule on write
 * (users.service.ts, `isSafeCoverCss`); this keeps a value written before that
 * rule existed from rendering either.
 */

const GRADIENT_START = /^(repeating-)?(linear|radial|conic)-gradient\(/i;
const ALLOWED_CHARS = /^[a-z0-9#%.,()\s/+-]*$/i;
const ALLOWED_FUNCTIONS = new Set([
  'linear-gradient', 'radial-gradient', 'conic-gradient',
  'repeating-linear-gradient', 'repeating-radial-gradient', 'repeating-conic-gradient',
  'rgb', 'rgba', 'hsl', 'hsla',
]);
export const MAX_COVER_CSS_LENGTH = 2000;

/** True for a string that starts like a gradient cover (safe or not). */
export function looksLikeCoverCss(value) {
  return typeof value === 'string' && GRADIENT_START.test(value.trim());
}

/** True when `value` is a gradient/pattern background this app will paint. */
export function isSafeCoverCss(value) {
  if (!looksLikeCoverCss(value)) return false;
  const css = value.trim();
  if (css.length > MAX_COVER_CSS_LENGTH || !ALLOWED_CHARS.test(css)) return false;
  for (const match of css.matchAll(/([a-z-]+)\s*\(/gi)) {
    if (!ALLOWED_FUNCTIONS.has(match[1].toLowerCase())) return false;
  }
  let depth = 0;
  for (const ch of css) {
    if (ch === '(') depth += 1;
    else if (ch === ')' && --depth < 0) return false;
  }
  return depth === 0;
}
