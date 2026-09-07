process.env.APP_ENV = process.env.APP_ENV || 'development';
process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'https://meetifyy.app';

import {
  buildShareMetadata,
  canonicalPostUrl,
  renderShareDocument,
  renderUnavailableDocument,
  shareImageUrl,
} from './share-document';
import type { PublicSharePost } from './share-preview.service';
import { sharePost } from './testing/share-post.fixture';

/**
 * The document a crawler reads.
 *
 * Two things are being protected. First, that the tags every unfurler needs are
 * present and absolute — a relative `og:image` is silently ignored by Facebook
 * and LinkedIn, which is exactly the kind of failure nobody notices until a
 * link is already shared. Second, that a display name is text in that document
 * and can never become markup.
 */
describe('share document', () => {
  const post = (over: Partial<PublicSharePost> = {}) => sharePost(over);

  const tag = (html: string, pattern: RegExp) =>
    html.match(pattern)?.[1] ?? null;

  describe('urls', () => {
    it('canonicalises to the app route, not to an API path', () => {
      expect(canonicalPostUrl(post().id)).toBe(
        'https://meetifyy.app/post/11111111-2222-4333-8444-555555555555',
      );
    });

    it('stamps the image URL with the post version, so an edit changes it', () => {
      const first = shareImageUrl(post());
      const edited = shareImageUrl(
        post({ updatedAt: new Date('2026-06-06T00:00:00.000Z') }),
      );

      expect(first).toContain(
        '/api/share/post/11111111-2222-4333-8444-555555555555/image.jpg?v=',
      );
      expect(first).not.toBe(edited);
      // The path is stable; only the query moves. That is what lets the
      // response be cached immutably for a year.
      expect(first.split('?')[0]).toBe(edited.split('?')[0]);
    });

    it('serves the image from the frontend origin, where the CDN is', () => {
      expect(shareImageUrl(post()).startsWith('https://meetifyy.app/')).toBe(
        true,
      );
    });
  });

  describe('metadata', () => {
    it('emits every tag the platforms actually read', () => {
      const html = renderShareDocument(post());

      for (const property of [
        'og:type',
        'og:site_name',
        'og:title',
        'og:description',
        'og:url',
        'og:image',
        'og:image:width',
        'og:image:height',
      ]) {
        expect(html).toContain(`property="${property}"`);
      }
      for (const name of [
        'twitter:card',
        'twitter:title',
        'twitter:description',
        'twitter:image',
      ]) {
        expect(html).toContain(`name="${name}"`);
      }
      expect(html).toContain('rel="canonical"');
      expect(tag(html, /name="twitter:card" content="([^"]+)"/)).toBe(
        'summary_large_image',
      );
    });

    it('gives og:url and canonical the same absolute value', () => {
      const html = renderShareDocument(post());
      const meta = buildShareMetadata(post());
      expect(tag(html, /property="og:url" content="([^"]+)"/)).toBe(
        meta.canonicalUrl,
      );
      expect(tag(html, /rel="canonical" href="([^"]+)"/)).toBe(
        meta.canonicalUrl,
      );
      expect(meta.canonicalUrl.startsWith('https://')).toBe(true);
      expect(meta.imageUrl.startsWith('https://')).toBe(true);
    });

    it('publishes a teaser, not the post', () => {
      const html = renderShareDocument(post({ text: 'secret '.repeat(400) }));
      const description =
        tag(html, /name="description" content="([^"]+)"/) ?? '';
      expect(description.length).toBeLessThanOrEqual(181);
    });

    it('sends a human on to the real post, without needing JavaScript', () => {
      const html = renderShareDocument(post());
      expect(html).toContain(`content="0; url=${canonicalPostUrl(post().id)}"`);
      expect(html).toContain(`<a href="${canonicalPostUrl(post().id)}"`);
      expect(html).not.toContain('<script');
    });
  });

  describe('a hostile display name is text, never markup', () => {
    const hostile =
      '"><script>alert(1)</script><meta property="og:url" content="https://evil.test';

    it('cannot break out of an attribute', () => {
      const html = renderShareDocument(
        post({
          author: { username: 'alex', displayName: hostile, avatarUrl: null },
        }),
      );

      expect(html).not.toContain('<script');
      expect(html).not.toContain('evil.test"');
      // Exactly one og:url, and it is ours.
      expect(html.match(/property="og:url"/g)).toHaveLength(1);
      expect(tag(html, /property="og:url" content="([^"]+)"/)).toBe(
        canonicalPostUrl(post().id),
      );
    });

    it('cannot inject through the post text either', () => {
      const html = renderShareDocument(post({ text: hostile }));
      expect(html).not.toContain('<script');
      expect(html.match(/property="og:url"/g)).toHaveLength(1);
    });
  });

  describe('the unavailable document', () => {
    it('carries no post data at all', () => {
      const html = renderUnavailableDocument();
      expect(html).not.toContain('11111111-2222-4333-8444-555555555555');
      expect(html).not.toContain('alex');
      expect(html).not.toContain('og:image');
      expect(html).toContain('noindex, nofollow');
    });

    it('is the same response whatever the reason', () => {
      // Deleted, private, restricted, suspended author, never existed — one
      // document, so the endpoint cannot be used to ask whether a private post
      // is real.
      expect(renderUnavailableDocument()).toBe(renderUnavailableDocument());
    });
  });
});
