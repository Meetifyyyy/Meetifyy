import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CacheControl } from '../common/decorators/cache-control.decorator';
import { SharePreviewService } from './share-preview.service';
import { ShareCardCache } from './share-card.cache';
import { ShareCardRenderer } from './share-card.renderer';
import {
  buildShareMetadata,
  canonicalPostUrl,
  renderShareDocument,
  renderUnavailableDocument,
  shareImageUrl,
} from './share-document';

/**
 * The public face of external sharing: three endpoints, no session required.
 *
 * These are the only routes in the application that serve post content to an
 * unauthenticated caller, and every one of them gets its data from
 * `SharePreviewService.getPublicPost` and nowhere else. That service is the
 * privacy gate; this controller's job is to say the same "not available" for
 * every reason a post might not be shareable, and to set cache headers that
 * mean the work is not repeated.
 *
 * WHY THIS IS NOT PART OF PostsController
 * `PostsController` is `@UseGuards(JwtGuard)` at the class level and every one
 * of its reads is written for a viewer — block filters, like state, bookmark
 * state, comment trees. Adding an unauthenticated route to it would put a
 * public endpoint one decorator away from every private one, and would invite
 * the next person to reuse `getPostById`, which returns far more than a
 * preview may show. A separate module keeps the public projection separate from
 * the authenticated one by construction.
 *
 * WHY NO EXPLICIT RATE LIMIT DECORATOR
 * `RateLimitGuard` is registered globally (see AppModule) and applies the
 * `global.ip` and `global.ip.burst` policies to every anonymous request,
 * including these. The cache headers below are what actually keeps crawler
 * traffic away from the origin: Vercel's CDN sits in front via the
 * `/api/share/*` rewrite and serves repeat fetches itself.
 */
@Controller('api/share')
export class ShareController {
  constructor(
    private readonly preview: SharePreviewService,
    private readonly cards: ShareCardCache,
  ) {}

  /**
   * The crawler-facing document. `vercel.json` rewrites `/post/:id` here when
   * the user agent is an unfurler; nothing else links to this URL.
   *
   * Five minutes at the edge with a day of `stale-while-revalidate`: an edited
   * post updates its preview within minutes, and a crawler re-fetching a
   * popular link never waits on the origin. A deleted post's document is
   * `no-store`, so the removal takes effect on the next fetch rather than
   * living in a cache for the rest of the day.
   */
  @Get('post/:id/preview')
  @CacheControl(
    'public, max-age=60, s-maxage=300, stale-while-revalidate=86400',
  )
  async crawlerDocument(@Param('id') id: string, @Res() res: Response) {
    const post = await this.preview.getPublicPost(id);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // The document differs by nothing but the URL, but it is served from a
    // route that also answers for other posts — Vary keeps a shared cache from
    // reusing one post's document for another if a rewrite is ever changed.
    res.setHeader('Vary', 'Accept-Encoding');

    if (!post) {
      res.setHeader('Cache-Control', 'no-store');
      res.status(404).send(renderUnavailableDocument());
      return;
    }

    res.status(200).send(renderShareDocument(post));
  }

  /**
   * The share card itself.
   *
   * The `v` query parameter is not read. It exists so that an edit to the post
   * produces a different URL — see `shareImageUrl` — which is what makes an
   * immutable year-long cache safe. Reading it and comparing would only create
   * a way for a stale crawler to pin an old card.
   */
  /**
   * The finished 1080x1920 story image, for handing to Instagram as a file.
   *
   * A separate endpoint rather than a query parameter on the one above, because
   * it is a different resource entirely: a different shape, a different size
   * and a different purpose. The path says so, caches key on it for free, and
   * the `.png` extension is what a share sheet reads to decide the file's type.
   *
   * NOT referenced by any `og:` tag. An unfurler wants the small landscape JPEG
   * — see shareImageUrl — and would letterbox this one into a chat thumbnail.
   */
  @Get('post/:id/story.png')
  @CacheControl('public, max-age=31536000, s-maxage=31536000, immutable')
  async story(@Param('id') id: string, @Res() res: Response) {
    const post = await this.preview.getPublicPost(id);

    if (!post) {
      res.setHeader('Cache-Control', 'no-store');
      res.status(404).end();
      return;
    }

    const card = await this.cards.get(post, 'story');

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Length', String(card.length));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.status(200).end(card);
  }

  @Get('post/:id/image.jpg')
  @CacheControl('public, max-age=31536000, s-maxage=31536000, immutable')
  async image(@Param('id') id: string, @Res() res: Response) {
    const post = await this.preview.getPublicPost(id);

    if (!post) {
      // No placeholder image and no redirect to one. An unfurler that gets a
      // 404 renders the card without an image, which is the correct outcome;
      // serving anything else would confirm the request reached a real post.
      res.setHeader('Cache-Control', 'no-store');
      res.status(404).end();
      return;
    }

    const card = await this.cards.get(post);

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Length', String(card.length));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.status(200).end(card);
  }

  /**
   * The public projection as JSON, for the signed-out post page.
   *
   * The same gate and the same fields as the card: an unauthenticated visitor
   * sees the author, the text and the first image, and nothing else. Comments,
   * like counts, poll results, bookmark state and the author's profile are all
   * absent — not because the page has no room for them, but because publishing
   * them would widen what "sharing a link" exposes well beyond the preview this
   * feature is for.
   */
  @Get('post/:id')
  @CacheControl('public, max-age=60, s-maxage=300, stale-while-revalidate=3600')
  async json(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const post = await this.preview.getPublicPost(id);

    if (!post) {
      res.setHeader('Cache-Control', 'no-store');
      res.status(404);
      // Identical for deleted, private, restricted and non-existent. See
      // SharePreviewService.
      return { available: false as const };
    }

    const meta = buildShareMetadata(post);

    return {
      available: true as const,
      post: {
        id: post.id,
        text: post.text,
        createdAt: post.createdAt.toISOString(),
        author: post.author,
        communityName: post.communityName,
        image: post.image,
        // The whole gallery, in order, so the signed-out page can show the post
        // as a post rather than as its first frame. Still only the images the
        // gate approved — see SharePreviewService.
        gallery: post.gallery,
        video: post.video,
        mediaKind: post.mediaKind,
        imageCount: post.imageCount,
        videoCount: post.videoCount,
        mediaCount: post.mediaCount,
        isPoll: post.isPoll,
        // Options without counts. A signed-out reader can see what is being
        // asked and what the choices are; how anyone voted needs an account,
        // and is not published here at all.
        pollOptions: post.pollOptions,
        pollOptionCount: post.pollOptionCount,
      },
      share: {
        canonicalUrl: canonicalPostUrl(post.id),
        imageUrl: shareImageUrl(post),
        title: meta.title,
        description: meta.description,
        width: ShareCardRenderer.WIDTH,
        height: ShareCardRenderer.HEIGHT,
      },
    };
  }
}
