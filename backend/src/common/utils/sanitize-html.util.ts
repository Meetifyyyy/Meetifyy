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
const REPLY_TAGS = ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'a', 'blockquote', 'code', 'pre', 'span'];

/** Articles additionally get headings and tables. */
const ARTICLE_TAGS = [...REPLY_TAGS, 'h2', 'h3', 'h4', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td'];

const BASE_OPTIONS: sanitizeHtml.IOptions = {
  allowedAttributes: {
    // `title` is dropped along with everything else not named here; `rel` and
    // `target` are forced below rather than accepted from the input.
    a: ['href'],
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
    // Every surviving link is untrusted and opens off-site.
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer nofollow', target: '_blank' }, true),
  },
};

export function sanitizeReplyHtml(dirty: string): string {
  return sanitizeHtml(dirty ?? '', { ...BASE_OPTIONS, allowedTags: REPLY_TAGS });
}

export function sanitizeArticleHtml(dirty: string): string {
  return sanitizeHtml(dirty ?? '', { ...BASE_OPTIONS, allowedTags: ARTICLE_TAGS });
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
    textFilter: (t, tagName) => (['p', 'br', 'li', 'h2', 'h3', 'h4', 'tr'].includes(tagName) ? `${t}\n` : t),
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
