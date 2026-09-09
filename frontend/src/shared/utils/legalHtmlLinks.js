/**
 * Link behaviour for stored legal/help HTML rendered with
 * `dangerouslySetInnerHTML`.
 *
 * The document bodies are authored in the admin portal and sanitized on write,
 * which is where `rel`/`target` are decided (see the backend's
 * `transformAnchor`). Two things still have to happen at render time:
 *
 *   1. The documents shipped in the seed migration never went through that
 *      sanitizer — they were inserted as SQL — so their anchors are bare. Every
 *      external link in the published Cookie Policy (Supabase, Google,
 *      Cloudflare, Vercel) therefore renders with no `rel` and no `target`:
 *      it navigates the reader out of the app in the same tab and passes link
 *      equity to a third party. Re-sanitizing stored rows would fix those four
 *      documents; hardening here fixes any document, including one published
 *      before the write path was corrected.
 *
 *   2. An internal cross-reference — the Privacy Policy's link to the Cookie
 *      Policy — is a plain `<a href="/cookie-policy">` inside injected HTML, so
 *      the browser does a full page load and re-boots the SPA. Routing it
 *      through the router keeps it an in-app navigation.
 *
 * Deliberately additive and idempotent: it never removes an attribute an author
 * set, and running it twice on the same node changes nothing.
 */

/** An absolute http(s) destination — a link that leaves Meetifyy. */
const EXTERNAL_HREF = /^https?:\/\//i;

/** True for a same-site path we can hand to the router. */
export function isInternalHref(href) {
  return typeof href === 'string' && href.startsWith('/') && !href.startsWith('//');
}

/**
 * Gives every off-site anchor under `root` a new tab and the usual protections.
 *
 * `noopener` is the one that matters: without it a `target="_blank"` page can
 * reach back through `window.opener`. It is applied whether or not this code
 * added the `target`, because an author-supplied `target="_blank"` needs it
 * just as much.
 */
export function hardenExternalLinks(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  for (const a of root.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href') || '';
    if (!EXTERNAL_HREF.test(href)) continue;
    if (!a.getAttribute('target')) a.setAttribute('target', '_blank');
    const rel = new Set((a.getAttribute('rel') || '').split(/\s+/).filter(Boolean));
    rel.add('noopener');
    rel.add('noreferrer');
    rel.add('nofollow');
    a.setAttribute('rel', [...rel].join(' '));
  }
}

/**
 * A click handler for the container of rendered legal HTML.
 *
 * Turns a click on an internal anchor into `navigate(href)`. Modified clicks
 * (new tab, new window, download) and anything with a `target` are left to the
 * browser, because the reader has asked for the browser's behaviour.
 */
export function makeInternalLinkHandler(navigate) {
  return (event) => {
    if (event.defaultPrevented) return;
    if (event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const anchor = event.target?.closest?.('a[href]');
    if (!anchor) return;
    if (anchor.getAttribute('target')) return;
    if (anchor.hasAttribute('download')) return;

    const href = anchor.getAttribute('href');
    if (!isInternalHref(href)) return;

    event.preventDefault();
    navigate(href);
  };
}

/**
 * Gives any table in stored document HTML its own horizontal scroller.
 *
 * `sanitizeArticleHtml` allows `table`/`thead`/`tbody`/`tr`/`th`/`td`, and the
 * stylesheet styles them — so an admin can legitimately put a comparison table
 * in the Cookie Policy. `.docHtml table` is `width: 100%` with no overflow
 * container, and a table's minimum content width wins over that: on a 375px
 * phone a four-column table pushes the whole page into horizontal scroll, which
 * is the one layout failure a legal page cannot shrug off.
 *
 * Wrapping at render time rather than in CSS keeps the table a real table —
 * `display: block` would fix the scroll but break `width: 100%` and column
 * sizing on desktop, where nothing is wrong today.
 *
 * Idempotent: a table already inside a wrapper is skipped, so re-running on the
 * same content does nothing.
 */
export const TABLE_SCROLLER_ATTR = 'data-doc-table-scroller';

export function wrapTablesForScroll(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  for (const table of root.querySelectorAll('table')) {
    if (table.parentElement?.hasAttribute?.(TABLE_SCROLLER_ATTR)) continue;
    const wrapper = root.ownerDocument.createElement('div');
    wrapper.setAttribute(TABLE_SCROLLER_ATTR, '');
    wrapper.style.overflowX = 'auto';
    wrapper.style.maxWidth = '100%';
    // Lets a keyboard user reach the scroller, which is otherwise unfocusable
    // and therefore unscrollable without a pointer.
    wrapper.setAttribute('tabindex', '0');
    wrapper.setAttribute('role', 'region');
    wrapper.setAttribute('aria-label', 'Table, scrollable');
    table.parentElement.insertBefore(wrapper, table);
    wrapper.appendChild(table);
  }
}
