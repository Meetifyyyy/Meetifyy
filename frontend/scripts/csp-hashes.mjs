/**
 * The CSP hashes of the inline scripts this app ships, and the ones vercel.json
 * allows.
 *
 * The report-only policy drops 'unsafe-inline' for scripts and allows each
 * inline script by its sha256 instead. Those hashes used to be maintained by a
 * Vite plugin that patched vercel.json after the build. It never ran: it read
 * `dist/app.html` in `closeBundle`, and that file is written by
 * `prerender-seo.mjs`, which runs after `vite build` has finished — so the
 * plugin found nothing and returned, silently, on every build. The hashes were
 * edited by hand instead, and three of the five had drifted.
 *
 * It could not have kept up regardless. The version gate carried the build
 * stamp in its own text, so its hash changed on every commit. The stamp now
 * lives in a meta tag, every inline script is byte-identical across builds, and
 * the correct list is simply a function of `index.html`. What is left to do is
 * check it, which is what this module is for: `verify-csp-hashes.mjs` runs it
 * against the built output and fails the build on a missing hash, and the unit
 * suite runs it against `index.html` and requires an exact match.
 */
import crypto from 'node:crypto';

/**
 * Script types a browser executes, and so the ones CSP `script-src` governs.
 * Anything else — `application/ld+json` above all — is a data block, never
 * run, and needs no hash.
 */
const EXECUTABLE_TYPES = new Set([
  '',
  'module',
  'importmap',
  'text/javascript',
  'application/javascript',
  'application/ecmascript',
  'text/ecmascript',
]);

/**
 * The `'sha256-…'` source for every executable inline script in `html`.
 *
 * Hashed exactly as a browser does: over the element's text, after the HTML
 * parser's newline normalisation (CRLF and lone CR become LF), so a checkout
 * with Windows line endings reports what a browser would ask for.
 */
export function inlineScriptHashes(html) {
  const hashes = [];
  const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let match;
  while ((match = scriptRe.exec(html)) !== null) {
    const [, attrs, body] = match;
    if (/\bsrc\s*=/i.test(attrs)) continue;
    const type = (/\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1] ?? '').toLowerCase();
    if (!EXECUTABLE_TYPES.has(type)) continue;
    const text = body.replace(/\r\n?/g, '\n');
    const digest = crypto.createHash('sha256').update(text, 'utf8').digest('base64');
    hashes.push(`'sha256-${digest}'`);
  }
  return [...new Set(hashes)];
}

/** The value of one directive in a policy string, or '' when absent. */
export function directive(policy, name) {
  return (
    policy
      .split(';')
      .map((d) => d.trim())
      .find((d) => d === name || d.startsWith(`${name} `)) || ''
  );
}

/** The report-only policy in a parsed vercel.json, or '' when it has none. */
export function reportOnlyPolicy(vercelConfig) {
  for (const entry of vercelConfig.headers || []) {
    for (const kv of entry.headers || []) {
      if (kv.key === 'Content-Security-Policy-Report-Only') return kv.value;
    }
  }
  return '';
}

/** The hash sources a directive lists. */
export function hashesIn(directiveValue) {
  return directiveValue.match(/'sha256-[A-Za-z0-9+/=]{44}'/g) || [];
}

/**
 * The two directives that must allow every inline script. `script-src-elem`
 * is what a browser consults for `<script>` elements when it is present, and
 * `script-src` is its fallback; both have to be right.
 */
export const SCRIPT_DIRECTIVES = ['script-src', 'script-src-elem'];
