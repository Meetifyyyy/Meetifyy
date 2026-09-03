import { createElement, Fragment, useMemo } from 'react';

/**
 * Renders stored rich text without ever handing raw HTML to the DOM.
 *
 * ── Why this exists when the backend already sanitizes ──────────────────────
 *
 * Help-centre articles and admin support replies are sanitized on write, with a
 * library-based allowlist, and that is the right place for it. This is not a
 * patch for a hole in that: it is the second half of the promise the schema
 * makes about this column — "stored sanitized on write so no reader has to
 * trust it" — enforced at the point that actually does the dangerous thing.
 *
 * The problem with trusting the write path alone is that its correctness has to
 * hold for every path that will ever write the column, forever. Today there are
 * two and both sanitize. A future import tool, a data migration, a support
 * script or an admin editing a row by hand does not go through them, and the
 * failure is silent and immediate: stored XSS on a public page. Nothing about
 * the render site says it is depending on that guarantee.
 *
 * So this parses the markup and rebuilds it as React elements from an
 * allowlist, rather than injecting it. `dangerouslySetInnerHTML` is not used
 * anywhere in the app now. An attribute that is not named below cannot survive,
 * which is what makes event handlers structurally impossible rather than merely
 * filtered — there is no code path that copies an `on*` attribute through.
 *
 * Parsing is done with DOMParser into a detached `text/html` document, which is
 * inert: scripts in it never execute and it fetches nothing. Only allowlisted
 * nodes are then read out of it.
 */

/**
 * Mirrors the backend's ARTICLE_TAGS (which is a superset of its reply tags),
 * so nothing an author is legitimately allowed to write is dropped here.
 */
const ALLOWED_TAGS = new Set([
  'p', 'br', 'strong', 'b', 'em', 'i', 'u',
  'ul', 'ol', 'li', 'a', 'blockquote', 'code', 'pre', 'span',
  'h2', 'h3', 'h4', 'hr',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
]);

/**
 * Elements whose text content is code or markup rather than prose. An
 * unrecognised tag keeps its children (so a stray <div> does not delete a
 * paragraph); these drop them, because the text itself is the payload.
 */
const DROP_ENTIRELY = new Set([
  'script', 'style', 'noscript', 'template', 'iframe', 'object', 'embed',
  'textarea', 'option', 'select', 'form', 'input', 'button', 'svg', 'math',
]);

/** Tags that take no children. */
const VOID_TAGS = new Set(['br', 'hr']);

/** The only attribute read from the input, on the only tag allowed to have one. */
const ALLOWED_ATTRIBUTES = { a: ['href'] };

/** Schemes the backend permits on a stored href. */
const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

function safeHref(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    // A base is supplied so a relative href still parses; the scheme check
    // below is what decides, and a relative link resolves to http(s).
    const parsed = new URL(raw, 'https://meetifyy.app');
    return SAFE_SCHEMES.has(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

function convert(node, key) {
  if (node.nodeType === 3 /* text */) return node.nodeValue;
  if (node.nodeType !== 1 /* element */) return null;

  const tag = node.tagName.toLowerCase();
  if (DROP_ENTIRELY.has(tag)) return null;

  const children = VOID_TAGS.has(tag) ? null : convertChildren(node);

  // Not on the list: drop the element, keep what it wrapped. Matches the
  // backend's `disallowedTagsMode: 'discard'`.
  if (!ALLOWED_TAGS.has(tag)) {
    return children ? createElement(Fragment, { key }, children) : null;
  }

  const props = { key };
  for (const name of ALLOWED_ATTRIBUTES[tag] || []) {
    const value = node.getAttribute(name);
    if (value == null) continue;
    if (name === 'href') {
      const href = safeHref(value);
      if (!href) continue;
      props.href = href;
      // Forced, never read from the input: a stored `target` or `rel` is not
      // trusted any more than a stored href is.
      props.target = '_blank';
      props.rel = 'noopener noreferrer nofollow';
    }
  }

  return VOID_TAGS.has(tag)
    ? createElement(tag, props)
    : createElement(tag, props, children);
}

function convertChildren(parent) {
  const out = [];
  let i = 0;
  for (const child of parent.childNodes) {
    const converted = convert(child, `n${i++}`);
    if (converted != null) out.push(converted);
  }
  return out.length ? out : null;
}

/**
 * @param {string} html   stored markup
 * @param {string} [as]   wrapper element, default `div`
 */
export default function SafeHtml({ html, as = 'div', className }) {
  const content = useMemo(() => {
    if (!html || typeof html !== 'string') return null;
    if (typeof DOMParser === 'undefined') return html.replace(/<[^>]*>/g, '');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return convertChildren(doc.body);
  }, [html]);

  if (!content) return null;
  return createElement(as, className ? { className } : null, content);
}
