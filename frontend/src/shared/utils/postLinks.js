/**
 * Turning a URL someone typed into a link that is safe to render and pleasant
 * to read, without changing where it goes.
 *
 * The dividing line this module keeps is the important one: the `href` is the
 * user's URL, untouched, and everything cosmetic happens to a separate display
 * string. Nothing here ever rewrites the destination.
 */

/**
 * URLs inside a run of text.
 *
 * `<>"'` are excluded from the match so a URL that appears inside quotes or
 * angle brackets ends at the quote rather than swallowing it. Backtick and the
 * bracket characters are deliberately NOT excluded — plenty of real URLs
 * contain brackets, so those are peeled off afterwards, and only when they are
 * unbalanced (see splitTrailingPunctuation).
 */
const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>"']+/gi;

/**
 * Query parameters that only identify a campaign or a referrer.
 *
 * A blocklist, not an allowlist, and deliberately conservative: an unknown
 * parameter is kept, because the cost of wrongly keeping one is an untidy
 * label, and the cost of wrongly dropping one is a link that lands on the
 * wrong page — or does not work at all. Everything here is inert by
 * definition; none of it selects content.
 *
 * These are removed from the DISPLAY STRING ONLY. The href keeps every
 * parameter, so a destination that does read one still receives it.
 */
const TRACKING_PARAMS = new Set([
  // Google / Urchin campaign tags
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'utm_id', 'utm_source_platform', 'utm_creative_format', 'utm_marketing_tactic',
  // Ad-click identifiers
  'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid',
  'fbclid', 'msclkid', 'twclid', 'ttclid', 'igshid', 'igsh',
  'yclid', 'rdt_cid', 'li_fat_id', 'epik',
  // Mail-platform recipient tags
  'mc_cid', 'mc_eid', 'ck_subscriber_id', '_hsenc', '_hsmi', 'vero_id', 'oly_enc_id',
  // Misc referrer noise
  'ref_src', 'ref_url', 'spm', 'scm', '_openstat',
]);

/** Sentence punctuation that can trail a URL without belonging to it. */
const TRAILING_PUNCTUATION = new Set(['.', ',', '!', '?', ';', ':', '"', "'", '»', '”', '’']);

const CLOSERS = { ')': '(', ']': '[', '}': '{' };

/**
 * Split a matched run into the URL and whatever sentence punctuation trailed it.
 *
 * "Look at https://example.com/a." should link `…/a`, not `…/a.`. Brackets are
 * only peeled when they are unbalanced, so a Wikipedia URL ending in `(film)`
 * survives while "(see https://example.com)" does not eat the closing paren.
 */
export function splitTrailingPunctuation(raw) {
  let url = String(raw || '');
  let trailing = '';

  for (;;) {
    const last = url[url.length - 1];
    if (!last) break;

    if (TRAILING_PUNCTUATION.has(last)) {
      trailing = last + trailing;
      url = url.slice(0, -1);
      continue;
    }

    const opener = CLOSERS[last];
    if (opener) {
      const opens = url.split(opener).length - 1;
      const closes = url.split(last).length - 1;
      if (closes > opens) {
        trailing = last + trailing;
        url = url.slice(0, -1);
        continue;
      }
    }
    break;
  }

  return { url, trailing };
}

/**
 * The absolute URL to navigate to, or null when it is not safe to link.
 *
 * A bare `example.com/x` typed without a scheme is assumed to be https. Anything
 * that does not parse, or that resolves to a scheme other than http(s), returns
 * null so the caller can render it as plain text — a `javascript:` payload
 * should not become an anchor at all, not even one pointing at "#".
 */
export function resolveHref(rawUrl) {
  const raw = String(rawUrl || '').trim();
  if (!raw) return null;

  /*
   * Assume https ONLY when there is no scheme at all.
   *
   * Testing for `https?://` and prepending otherwise is not the same thing, and
   * the difference is a hole: `file:///etc/passwd` has a scheme, fails that
   * test, and gets `https://` glued on to produce `https://file///etc/passwd` —
   * a laundered URL pointing at a host called "file". Some other schemes
   * happened to be rejected only because the result failed to parse, which is
   * luck rather than a rule.
   *
   * So a string that carries any scheme is judged on that scheme, and only a
   * bare `example.com/x` is promoted to https.
   */
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw);
  if (hasScheme && !/^https?:\/\//i.test(raw)) return null;

  const candidate = hasScheme ? raw : `https://${raw}`;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  // A URL with no host ("https://") is not somewhere anyone can go.
  if (!parsed.hostname) return null;

  // `parsed.href` rather than the raw string: it is the normalised, correctly
  // encoded form of exactly the same destination, which keeps a stray space or
  // an unencoded character from producing a broken attribute.
  return parsed.href;
}

/**
 * A readable label for a URL. Cosmetic only — never used as the href.
 *
 * Drops the scheme, a leading `www.` and a bare trailing slash, and strips the
 * campaign parameters listed above. Query parameters that are not on that list
 * are KEPT, because they routinely select the content: `?v=` on YouTube,
 * `?id=` on a doc, a `?page=`. Dropping the whole query — which is what this
 * used to do — made two different videos render as the same label.
 *
 * The fragment is kept for the same reason: on a docs page it is the section
 * being linked to.
 */
export function formatUrlForDisplay(rawUrl) {
  const raw = String(rawUrl || '').trim();
  if (!raw) return '';

  let parsed;
  try {
    parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return raw.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  }

  let host = parsed.hostname.replace(/^www\./i, '');
  let path = parsed.pathname === '/' ? '' : parsed.pathname;
  if (path.endsWith('/')) path = path.slice(0, -1);

  const params = new URLSearchParams(parsed.search);
  for (const key of [...params.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) params.delete(key);
  }
  const query = params.toString();

  // `decodeURI`, not `decodeURIComponent`: it leaves the structural characters
  // (`?`, `&`, `#`, `/`) encoded where they were escaped on purpose, so a label
  // cannot suggest a different shape of URL than the href actually has.
  const decode = (s) => { try { return decodeURI(s); } catch { return s; } };

  return `${host}${decode(path)}${query ? `?${decode(query)}` : ''}${parsed.hash ? decode(parsed.hash) : ''}`;
}

/**
 * Shorten a display label from the middle.
 *
 * The two ends of a URL are the informative parts — the domain says who it is,
 * the tail usually says what it is — so a long path loses its centre rather
 * than its end. Below a short threshold there is nothing useful to keep on both
 * sides, so it simply truncates.
 */
export function truncateUrlLabel(label, limit) {
  const text = String(label || '');
  if (!Number.isFinite(limit) || limit <= 0 || text.length <= limit) return text;
  if (limit < 12) return `${text.slice(0, Math.max(0, limit - 1))}…`;

  const head = Math.ceil((limit - 1) * 0.62);
  const tail = limit - 1 - head;
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
}

/** A fresh matcher. `/g` regexes carry `lastIndex`, so they are never shared. */
export function createUrlMatcher() {
  return new RegExp(URL_PATTERN.source, 'gi');
}
