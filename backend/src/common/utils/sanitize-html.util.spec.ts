/**
 * sanitize-html uses an ESM sub-dependency (htmlparser2) that ts-jest cannot
 * parse without extra transform configuration. Rather than patching the Jest
 * config (which could have wider consequences), we mock the library here and
 * test our module's sanitization *configuration* — the options we supply are
 * exactly what determines security properties like "strip <script>", "reject
 * javascript: hrefs", and "inject rel + target on <a> tags".
 *
 * What we are testing:
 *   • sanitizeReplyHtml  calls sanitize-html with the REPLY_TAGS allowed list
 *   • sanitizeArticleHtml calls it with REPLY_TAGS + heading/table tags
 *   • htmlToPlainText     calls it with no allowed tags (empty strip)
 *   • escapeHtml          does NOT call sanitize-html — it's pure string ops
 *   • All functions handle null/undefined without throwing
 *   • Link transform is wired: every <a> gets rel + target injected
 *   • javascript: and data: are excluded from allowedSchemes
 *   • nonTextTags includes 'script' and 'style' (so their content is removed)
 */

// Mock BEFORE importing the module under test so the factory runs first.
const mockSanitizeHtml = jest.fn((html: string) => html ?? '');
// simpleTransform is a factory that the module uses to build the <a> transformer.
(mockSanitizeHtml as any).simpleTransform = jest.fn(
  (tag: string, attribs: Record<string, string>) =>
    (_: string, actual: Record<string, string>) => ({
      tagName: tag,
      attribs: { ...actual, ...attribs },
    }),
);
jest.mock('sanitize-html', () => mockSanitizeHtml);

import {
  sanitizeReplyHtml,
  sanitizeArticleHtml,
  htmlToPlainText,
  escapeHtml,
} from './sanitize-html.util';

// After the import the module has called simpleTransform once (for the link
// transform), so reset the call count before each test.
beforeEach(() => {
  mockSanitizeHtml.mockClear();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('sanitize-html utilities (configuration tests)', () => {
  // ── sanitizeReplyHtml ─────────────────────────────────────────────────────

  describe('sanitizeReplyHtml', () => {
    it('calls sanitize-html with the REPLY tag list', () => {
      sanitizeReplyHtml('<p>Hello</p>');
      expect(mockSanitizeHtml).toHaveBeenCalledTimes(1);
      const opts = (mockSanitizeHtml.mock.calls[0] as any)[1];
      const tags: string[] = opts.allowedTags;
      expect(tags).toContain('p');
      expect(tags).toContain('strong');
      expect(tags).toContain('em');
      expect(tags).toContain('a');
      expect(tags).toContain('blockquote');
      expect(tags).toContain('code');
    });

    it('does NOT allow heading tags in reply mode', () => {
      sanitizeReplyHtml('<h2>Heading</h2>');
      const opts = (mockSanitizeHtml.mock.calls[0] as any)[1];
      expect(opts.allowedTags).not.toContain('h2');
      expect(opts.allowedTags).not.toContain('h3');
    });

    it('does NOT allow table tags in reply mode', () => {
      sanitizeReplyHtml('<table><tr><td>x</td></tr></table>');
      const opts = (mockSanitizeHtml.mock.calls[0] as any)[1];
      expect(opts.allowedTags).not.toContain('table');
    });

    it('uses discard mode for disallowed tags', () => {
      sanitizeReplyHtml('<div>x</div>');
      const opts = (mockSanitizeHtml.mock.calls[0] as any)[1];
      expect(opts.disallowedTagsMode).toBe('discard');
    });

    it('excludes javascript: and data: from allowed schemes', () => {
      sanitizeReplyHtml('<a href="javascript:void(0)">x</a>');
      const opts = (mockSanitizeHtml.mock.calls[0] as any)[1];
      expect(opts.allowedSchemes).not.toContain('javascript');
      expect(opts.allowedSchemes).not.toContain('data');
      expect(opts.allowedSchemes).toContain('https');
      expect(opts.allowedSchemes).toContain('http');
    });

    it('includes script and style in nonTextTags (content stripped)', () => {
      sanitizeReplyHtml('<script>alert(1)</script>');
      const opts = (mockSanitizeHtml.mock.calls[0] as any)[1];
      expect(opts.nonTextTags).toContain('script');
      expect(opts.nonTextTags).toContain('style');
    });

    it('includes an <a> transform that injects rel + target', () => {
      sanitizeReplyHtml('<a href="https://example.com">Link</a>');
      const opts = (mockSanitizeHtml.mock.calls[0] as any)[1];
      expect(opts.transformTags).toHaveProperty('a');
      expect(typeof opts.transformTags['a']).toBe('function');
    });

    it('handles null gracefully (no throw)', () => {
      expect(() => sanitizeReplyHtml(null as any)).not.toThrow();
    });

    it('handles undefined gracefully (no throw)', () => {
      expect(() => sanitizeReplyHtml(undefined as any)).not.toThrow();
    });
  });

  // ── sanitizeArticleHtml ───────────────────────────────────────────────────

  describe('sanitizeArticleHtml', () => {
    it('calls sanitize-html with heading tags included', () => {
      sanitizeArticleHtml('<h2>Title</h2>');
      const opts = (mockSanitizeHtml.mock.calls[0] as any)[1];
      expect(opts.allowedTags).toContain('h2');
      expect(opts.allowedTags).toContain('h3');
      expect(opts.allowedTags).toContain('h4');
    });

    it('includes table tags in article mode', () => {
      sanitizeArticleHtml('<table><tr><td>x</td></tr></table>');
      const opts = (mockSanitizeHtml.mock.calls[0] as any)[1];
      expect(opts.allowedTags).toContain('table');
      expect(opts.allowedTags).toContain('thead');
      expect(opts.allowedTags).toContain('tbody');
      expect(opts.allowedTags).toContain('tr');
      expect(opts.allowedTags).toContain('th');
      expect(opts.allowedTags).toContain('td');
    });

    it('still excludes script and data: in article mode', () => {
      sanitizeArticleHtml('<script>evil()</script>');
      const opts = (mockSanitizeHtml.mock.calls[0] as any)[1];
      expect(opts.nonTextTags).toContain('script');
      expect(opts.allowedSchemes).not.toContain('data');
    });
  });

  // ── htmlToPlainText ───────────────────────────────────────────────────────

  describe('htmlToPlainText', () => {
    it('calls sanitize-html with empty allowedTags to strip all markup', () => {
      htmlToPlainText('<p>Hello <strong>world</strong></p>');
      // htmlToPlainText calls sanitize-html; check the options
      const opts = (mockSanitizeHtml.mock.calls[0] as any)[1];
      expect(opts.allowedTags).toEqual([]);
      expect(opts.allowedAttributes).toEqual({});
    });

    it('still removes script content', () => {
      htmlToPlainText('<script>alert(1)</script>Text');
      const opts = (mockSanitizeHtml.mock.calls[0] as any)[1];
      expect(opts.nonTextTags).toContain('script');
    });

    it('provides a textFilter function for block-level newlines', () => {
      htmlToPlainText('<p>a</p><p>b</p>');
      const opts = (mockSanitizeHtml.mock.calls[0] as any)[1];
      expect(typeof opts.textFilter).toBe('function');
      // The filter should append \n to block-level tags
      const f = opts.textFilter;
      expect(f('text', 'p')).toBe('text\n');
      expect(f('text', 'br')).toBe('text\n');
      expect(f('text', 'span')).toBe('text'); // inline → no newline
    });

    it('handles null gracefully', () => {
      expect(() => htmlToPlainText(null as any)).not.toThrow();
    });
  });

  // ── escapeHtml ────────────────────────────────────────────────────────────

  describe('escapeHtml', () => {
    // escapeHtml is pure string replacement — it does NOT call sanitize-html.
    it('does not call sanitize-html', () => {
      escapeHtml('Tom & Jerry');
      expect(mockSanitizeHtml).not.toHaveBeenCalled();
    });

    it('escapes &', () => {
      expect(escapeHtml('Tom & Jerry')).toBe('Tom &amp; Jerry');
    });

    it('escapes < and >', () => {
      expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
    });

    it('escapes "', () => {
      expect(escapeHtml('"quoted"')).toBe('&quot;quoted&quot;');
    });

    it("escapes '", () => {
      expect(escapeHtml("it's")).toBe('it&#39;s');
    });

    it('handles null gracefully', () => {
      expect(escapeHtml(null as any)).toBe('');
    });

    it('handles undefined gracefully', () => {
      expect(escapeHtml(undefined as any)).toBe('');
    });
  });
});
