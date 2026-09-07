process.env.APP_ENV = process.env.APP_ENV || 'development';

import { config } from '../config';
import { ShareController } from './share.controller';
import type { PublicSharePost } from './share-preview.service';
import { sharePost } from './testing/share-post.fixture';

/**
 * The site origin these tests assert against.
 *
 * Read from configuration rather than hardcoded. `FRONTEND_URL` is a required
 * variable that differs per environment — CI sets `http://localhost:3000`, a
 * developer's `.env` sets the dev host — so a spec that asserts a literal
 * `https://meetifyy.app` passes on one machine and fails on the other. It did:
 * these suites went green locally and red in CI on the same commit.
 *
 * What is worth asserting is the RELATIONSHIP — that the canonical URL is the
 * configured site plus `/post/:id` — and that holds everywhere.
 */
const SITE = config.app.frontendUrl.replace(/\/+$/, '');

/**
 * The three public endpoints, tested for the one property that matters most:
 * a post that may not be shared produces the same answer whatever the reason,
 * and that answer contains nothing.
 */
describe('ShareController', () => {
  const POST_ID = '11111111-2222-4333-8444-555555555555';

  const post = (over: Partial<PublicSharePost> = {}) => sharePost(over);

  const makeRes = () => {
    const headers: Record<string, string> = {};
    const res: any = {
      statusCode: 200,
      body: undefined as any,
      setHeader: (k: string, v: string) => {
        headers[k.toLowerCase()] = v;
        return res;
      },
      status: (code: number) => {
        res.statusCode = code;
        return res;
      },
      send: (body: any) => {
        res.body = body;
        return res;
      },
      end: (body?: any) => {
        if (body !== undefined) res.body = body;
        return res;
      },
      headers,
    };
    return res;
  };

  const setup = (result: PublicSharePost | null) => {
    const cards = {
      get: jest.fn().mockResolvedValue(Buffer.from('jpeg-bytes')),
    };
    const preview = { getPublicPost: jest.fn().mockResolvedValue(result) };
    return {
      controller: new ShareController(preview as any, cards as any),
      cards,
      preview,
    };
  };

  describe('a post that may not be shared', () => {
    it('answers the crawler document with 404 and nothing about the post', async () => {
      const { controller } = setup(null);
      const res = makeRes();

      await controller.crawlerDocument(POST_ID, res);

      expect(res.statusCode).toBe(404);
      expect(res.body).not.toContain(POST_ID);
      expect(res.body).not.toContain('og:image');
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('answers the image with an empty 404, never a placeholder', async () => {
      const { controller, cards } = setup(null);
      const res = makeRes();

      await controller.image(POST_ID, res);

      expect(res.statusCode).toBe(404);
      expect(res.body).toBeUndefined();
      expect(res.headers['cache-control']).toBe('no-store');
      // The renderer is never reached, so a private post costs nothing to probe
      // and produces no card that could be cached anywhere.
      expect(cards.get).not.toHaveBeenCalled();
    });

    it('answers the JSON endpoint with an availability flag and no fields', async () => {
      const { controller } = setup(null);
      const res = makeRes();

      const body = await controller.json(POST_ID, res);

      expect(res.statusCode).toBe(404);
      expect(body).toEqual({ available: false });
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('never caches a refusal, so a deletion takes effect on the next fetch', async () => {
      const { controller } = setup(null);
      for (const call of [
        (res: any) => controller.crawlerDocument(POST_ID, res),
        (res: any) => controller.image(POST_ID, res),
        (res: any) => controller.json(POST_ID, res),
      ]) {
        const res = makeRes();
        await call(res);
        expect(res.headers['cache-control']).toBe('no-store');
      }
    });
  });

  describe('a public post', () => {
    it('serves a document carrying the metadata', async () => {
      const { controller } = setup(post());
      const res = makeRes();

      await controller.crawlerDocument(POST_ID, res);

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(res.body).toContain('property="og:image"');
      expect(res.body).toContain(`${SITE}/post/${POST_ID}`);
    });

    it('serves the card as a JPEG with its length declared', async () => {
      const { controller, cards } = setup(post());
      const res = makeRes();

      await controller.image(POST_ID, res);

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('image/jpeg');
      expect(res.headers['content-length']).toBe('10');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(cards.get).toHaveBeenCalledWith(post());
    });

    it('returns only the preview projection, never engagement or viewer state', async () => {
      const { controller } = setup(post());
      const body: any = await controller.json(POST_ID, makeRes());

      // The allow-list, asserted exactly. A field added to the projection is a
      // field published to anyone with the link, so it has to be a decision
      // somebody makes here rather than something that arrives by spreading a
      // wider object.
      expect(Object.keys(body.post).sort()).toEqual([
        'author',
        'communityName',
        'createdAt',
        'gallery',
        'id',
        'image',
        'imageCount',
        'isPoll',
        'mediaCount',
        'mediaKind',
        'pollOptionCount',
        'pollOptions',
        'text',
        'video',
        'videoCount',
      ]);
      expect(body.post).not.toHaveProperty('likeCount');
      expect(body.post).not.toHaveProperty('comments');
      expect(body.post).not.toHaveProperty('isLiked');
      // Never the author's row timestamp: it is carried on the projection only
      // so the cache key can see a rename, and it is nobody else's business.
      expect(body.post).not.toHaveProperty('authorUpdatedAt');
      expect(body.post).not.toHaveProperty('updatedAt');
      expect(body.share.canonicalUrl).toBe(`${SITE}/post/${POST_ID}`);
    });
  });

  it('reads every surface through the one privacy gate', async () => {
    const { controller, preview } = setup(post());
    await controller.crawlerDocument(POST_ID, makeRes());
    await controller.image(POST_ID, makeRes());
    await controller.json(POST_ID, makeRes());

    expect(preview.getPublicPost).toHaveBeenCalledTimes(3);
    for (const call of preview.getPublicPost.mock.calls) {
      expect(call).toEqual([POST_ID]);
    }
  });
});
