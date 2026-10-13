/**
 * Gradient and pattern profile covers are stored as their CSS, and every
 * viewer's browser paints that string as a background. Only gradient
 * functions, colours and plain lengths are accepted, so a cover cannot make a
 * viewer fetch a URL (`url()`, `image-set()`) or read page state (`var()`).
 *
 * Mirrors frontend/src/shared/lib/covers/coverCss.js, which applies the same
 * rule at render time to anything stored before this check existed.
 */
const GRADIENT_START = /^(repeating-)?(linear|radial|conic)-gradient\(/i;
const ALLOWED_CHARS = /^[a-z0-9#%.,()\s/+-]*$/i;
const ALLOWED_FUNCTIONS = new Set([
  'linear-gradient',
  'radial-gradient',
  'conic-gradient',
  'repeating-linear-gradient',
  'repeating-radial-gradient',
  'repeating-conic-gradient',
  'rgb',
  'rgba',
  'hsl',
  'hsla',
]);
export const MAX_COVER_CSS_LENGTH = 2000;

/** True for a value that is meant to be a gradient cover (safe or not). */
export function looksLikeCoverCss(value: string): boolean {
  return GRADIENT_START.test(value.trim());
}

export function isSafeCoverCss(value: string): boolean {
  const css = value.trim();
  if (!looksLikeCoverCss(css)) return false;
  if (css.length > MAX_COVER_CSS_LENGTH || !ALLOWED_CHARS.test(css)) {
    return false;
  }
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
