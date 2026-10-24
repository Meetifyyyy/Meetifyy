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
 * The left and right edges the same way, with `--side-inset-left/right`: the
 * landscape camera cutout and a side navigation bar. Those are 0 on every
 * screen except one that draws under the side insets itself
 * (`useSystemBars({ sides: 'transparent' })`, see mobile.css) — everywhere
 * else the window is padded there and the content never reaches them.
 *
 * Not the top edge. It is owned by `--status-bar-inset` and by the page's own
 * layout (a screen decides whether to draw under the status bar), so rewriting
 * it here would override that decision everywhere at once.
 *
 * Plain ES module with no imports: it runs in Node (the PostCSS plugin) as well
 * as in tests.
 */

/** Each edge's env() and the native value it is paired with. */
const EDGES = [
  ['env(safe-area-inset-bottom', 'var(--navigation-bar-inset, 0px)'],
  ['env(safe-area-inset-left', 'var(--side-inset-left, 0px)'],
  ['env(safe-area-inset-right', 'var(--side-inset-right, 0px)'],
];

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

/** Rewrites every bottom, left and right safe-area `env()` in a declaration value. */
export function withNativeNavigationInset(value) {
  if (typeof value !== 'string') return value;
  return EDGES.reduce((v, [needle, native]) => pairWithNative(v, needle, native), value);
}

function pairWithNative(value, needle, nativeInset) {
  if (!value.includes(needle)) return value;

  let out = '';
  let cursor = 0;
  for (;;) {
    const at = value.indexOf(needle, cursor);
    if (at === -1) break;
    const open = at + 'env'.length;
    const close = matchingParen(value, open);
    if (close === -1) break;

    const call = value.slice(at, close + 1);
    // Idempotent: a value already written as max(env(...), var(--native-inset))
    // is left as it is rather than wrapped a second time.
    const after = value.slice(close + 1, close + 1 + nativeInset.length + 3);
    const alreadyPaired = after.replace(/\s+/g, '').startsWith(`,${nativeInset.replace(/\s+/g, '')}`);

    out += value.slice(cursor, at);
    out += alreadyPaired ? call : `max(${call}, ${nativeInset})`;
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
