/**
 * Makes every `env(safe-area-inset-bottom)` in the app's stylesheets mean "the
 * height of the phone's navigation bar" — installed app only.
 *
 * WHY THE STYLESHEETS NEED IT
 * The WebView runs edge to edge, so the navigation bar covers the bottom of the
 * page and every bottom-anchored surface has to keep its controls clear of it.
 * The stylesheets already do that for iOS and for installed PWAs: modals,
 * toasts, sheets, the bottom nav and the composer all pad by
 * `env(safe-area-inset-bottom)`. Android's WebView, though, only reports that
 * value in recent versions and not reliably while the keyboard is up, so the
 * native shell publishes the bar's height itself as `--navigation-bar-inset`
 * (see SystemUiPlugin.java).
 *
 * Rather than edit each of the ~70 places that read the env value, the mobile
 * build reads the two together, in one place:
 *
 *   env(safe-area-inset-bottom, 0px)
 *     -> max(env(safe-area-inset-bottom, 0px), var(--navigation-bar-inset, 0px))
 *
 * `max`, not a sum: a WebView that DOES report the inset reports the same
 * number, and adding the two would double it. The website never loads this, so
 * its stylesheets are untouched.
 *
 * Only the bottom edge. The top edge is owned by `--status-bar-inset` and by the
 * page's own layout (a screen decides whether to draw under the status bar), so
 * rewriting it here would override that decision everywhere at once.
 *
 * Plain ES module with no imports: it runs in Node (the PostCSS plugin) as well
 * as in tests.
 */

const NEEDLE = 'env(safe-area-inset-bottom';
const NATIVE_INSET = 'var(--navigation-bar-inset, 0px)';

/** Index of the `)` matching the `(` at `open`, or -1. */
function matchingParen(value, open) {
  let depth = 0;
  for (let i = open; i < value.length; i += 1) {
    if (value[i] === '(') depth += 1;
    else if (value[i] === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Rewrites every bottom safe-area `env()` in a declaration value. */
export function withNativeNavigationInset(value) {
  if (typeof value !== 'string' || !value.includes(NEEDLE)) return value;

  let out = '';
  let cursor = 0;
  for (;;) {
    const at = value.indexOf(NEEDLE, cursor);
    if (at === -1) break;
    const open = at + 'env'.length;
    const close = matchingParen(value, open);
    if (close === -1) break;

    const call = value.slice(at, close + 1);
    // Idempotent: a value already written as max(env(...), var(--navigation-bar-inset))
    // is left as it is rather than wrapped a second time.
    const after = value.slice(close + 1, close + 1 + NATIVE_INSET.length + 3);
    const alreadyPaired = after.replace(/\s+/g, '').startsWith(`,${NATIVE_INSET.replace(/\s+/g, '')}`);

    out += value.slice(cursor, at);
    out += alreadyPaired ? call : `max(${call}, ${NATIVE_INSET})`;
    cursor = close + 1;
  }
  return out + value.slice(cursor);
}

/** PostCSS plugin applying `withNativeNavigationInset` to every declaration. */
export function safeAreaPostcss() {
  return {
    postcssPlugin: 'meetifyy-native-navigation-inset',
    Declaration(decl) {
      const next = withNativeNavigationInset(decl.value);
      if (next !== decl.value) decl.value = next;
    },
  };
}
safeAreaPostcss.postcss = true;
