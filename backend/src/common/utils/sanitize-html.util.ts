import sanitizeHtml from 'sanitize-html';

/**
 * HTML sanitization for the two places the platform stores author-supplied
 * rich text: help-centre article bodies and admin support replies.
 *
 * Both are sanitized on write rather than on read. Sanitizing on read would
 * mean every consumer - the public page, the admin thread view, the outgoing
 * email renderer - has to remember to do it, and the email renderer is the one
 * that cannot: its output is inlined into a message that no browser CSP
 * protects. Storing only clean markup means there is no unsanitized copy to
 * leak through a path someone forgets about.
 */

/** Formatting an admin can apply in a reply, and nothing that can execute. */
const REPLY_TAGS = [
  'p',
  'br',
  'strong',
  'b',
  'em',
  'i',
  'u',
  'ul',
  'ol',
  'li',
  'a',
  'blockquote',
  'code',
  'pre',
  'span',
];

/** Articles additionally get headings and tables. */
const ARTICLE_TAGS = [
  ...REPLY_TAGS,
  'h2',
  'h3',
  'h4',
  'hr',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
];

/** An absolute http(s) destination — i.e. a link that leaves Meetifyy. */
const EXTERNAL_HREF = /^https?:\/\//i;

/**
 * Decides `rel` and `target` from the destination, and never from the input.
 *
 * Author-supplied `rel`/`target` are discarded rather than merged: the whole
 * point is that these two attributes are the sanitizer's decision, so an author
 * (or a compromised admin session) cannot opt a link out of them or aim one at
 * a named frame.
 *
 * Only EXTERNAL links get them. `simpleTransform` applied them to every link
 * including relative ones, which would have made an internal cross-reference —
 * the Privacy Policy's link to the Cookie Policy, say — open a second tab and
 * carry `nofollow` on our own page. Off-site is what the rule is about.
 */
export function transformAnchor(
  _tagName: string,
  attribs: Record<string, string>,
): { tagName: string; attribs: Record<string, string> } {
  const href = attribs?.href ?? '';
  const out: Record<string, string> = {};
  if (href) out.href = href;
  if (EXTERNAL_HREF.test(href)) {
    out.target = '_blank';
    out.rel = 'noopener noreferrer nofollow';
  }
  return { tagName: 'a', attribs: out };
}

const BASE_OPTIONS: sanitizeHtml.IOptions = {
  allowedAttributes: {
    /**
     * `target` and `rel` are listed because sanitize-html applies this filter
     * AFTER `transformTags` runs. With `a: ['href']` alone the transform below
     * injected both attributes and this filter immediately stripped them again,
     * so every link shipped WITHOUT `rel="noopener noreferrer nofollow"` and
     * without `target="_blank"` — the protection the code documents was never
     * actually applied to a single link.
     *
     * It went unnoticed because the unit test mocks `sanitize-html` (the package
     * is ESM and cannot be loaded in this jest setup) and only asserted that a
     * transform was configured, never what came out the other side.
     *
     * Allowing them here is safe: `transformAnchor` rebuilds the attribute set
     * from scratch, so an author-supplied `target`/`rel` is dropped rather than
     * passed through.
     */
    a: ['href', 'target', 'rel'],
  },
  // No `javascript:` and no `data:` - a data URL can carry an HTML document.
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesAppliedToAttributes: ['href'],
  // Anything not on the tag list has its markup removed but its text kept, so
  // a stray <div> does not silently delete a paragraph of an admin's reply.
  // `script` and `style` are the exception: their *contents* are code, so the
  // text has to go too.
  nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript'],
  disallowedTagsMode: 'discard',
  transformTags: {
    // Off-site links open in a new tab and carry noopener/noreferrer/nofollow;
    // internal ones are left as ordinary in-app links. See transformAnchor.
    a: transformAnchor,
  },
};

export function sanitizeReplyHtml(dirty: string): string {
  return sanitizeHtml(dirty ?? '', {
    ...BASE_OPTIONS,
    allowedTags: REPLY_TAGS,
  });
}

export function sanitizeArticleHtml(dirty: string): string {
  return sanitizeHtml(dirty ?? '', {
    ...BASE_OPTIONS,
    allowedTags: ARTICLE_TAGS,
  });
}

/**
 * Strips markup entirely. Used for the plain-text email alternative and for
 * the search excerpts on the public help page, neither of which renders HTML.
 */
export function htmlToPlainText(html: string): string {
  const text = sanitizeHtml(html ?? '', {
    allowedTags: [],
    allowedAttributes: {},
    nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript'],
    // Without this, `<p>a</p><p>b</p>` collapses to "ab".
    textFilter: (t, tagName) =>
      ['p', 'br', 'li', 'h2', 'h3', 'h4', 'tr'].includes(tagName)
        ? `${t}\n`
        : t,
  });
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Escapes text for interpolation into an HTML email body. User-submitted
 * ticket text is plain text and must stay plain text when quoted back.
 */
export function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
