process.env.APP_ENV = process.env.APP_ENV || 'development';

import { config } from '../config';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ShareController } from './share.controller';
import { SharePreviewService } from './share-preview.service';
import { ShareCardRenderer } from './share-card.renderer';
import { ShareCardCache } from './share-card.cache';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../uploads/uploads.service';
import { MediaCleanupService } from '../uploads/media-cleanup.service';
import { RedisService } from '../redis/redis.service';
import { NoCacheInterceptor } from '../common/interceptors/no-cache.interceptor';
import { APP_INTERCEPTOR } from '@nestjs/core';

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
 * The routes as HTTP, with a real renderer.
 *
 * The unit tests cover the gate and the document; this covers the things only a
 * real request exercises — that the three paths do not shadow each other, that
 * the cache headers survive the global NoCacheInterceptor (which defaults every
 * undecorated route to `no-store` and would silently kill the CDN caching this
 * feature depends on), and that the image endpoint actually returns a JPEG of
 * the right dimensions rather than something that merely claims to be one.
 *
 * Prisma is the only thing mocked. sharp is real, so a card that cannot be
 * composed fails here rather than in production.
 */
describe('share routes', () => {
  const POST_ID = '11111111-2222-4333-8444-555555555555';

  let app: INestApplication;
  let findFirst: jest.Mock;

  const postRow = (over: any = {}) => ({
    id: POST_ID,
    text: 'Anyone up for badminton at the sports complex tomorrow evening?',
    createdAt: new Date('2026-01-02T03:04:05.000Z'),
    updatedAt: new Date('2026-02-03T04:05:06.000Z'),
    author: {
      username: 'alex',
      displayName: 'Alex Kuriakose',
      avatar: null,
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    },
    community: null,
    media: [],
    pollOptions: [],
    _count: { media: 0, pollOptions: 0 },
    ...over,
  });

  /** A media row as the database really stores one — note the UPPERCASE type. */
  const mediaRow = (over: any = {}) => ({
    objectKey: 'posts/photo.webp',
    mimeType: 'image/webp',
    type: 'IMAGE',
    width: 1200,
    height: 900,
    visibility: 'public',
    ...over,
  });

  beforeAll(async () => {
    findFirst = jest.fn();

    const moduleRef = await Test.createTestingModule({
      controllers: [ShareController],
      providers: [
        SharePreviewService,
        ShareCardRenderer,
        ShareCardCache,
        { provide: APP_INTERCEPTOR, useClass: NoCacheInterceptor },
        { provide: PrismaService, useValue: { post: { findFirst } } },
        {
          provide: StorageService,
          useValue: {
            getPublicUrl: (key: string) => `https://cdn.example/${key}`,
            isAlwaysPrivateKey: (key: string) =>
              key.startsWith('verification/'),
          },
        },
        {
          provide: MediaCleanupService,
          useValue: { variantKeysFor: (key: string) => [key] },
        },
        // No Redis in tests. The cache is written to degrade to "render every
        // time" when the client is null, and asserting that here is worth as
        // much as asserting the hit path: an outage must not take sharing down.
        {
          provide: RedisService,
          useValue: {
            getClient: () => null,
            withLock: (_k: string, _t: number, fn: any) => fn(),
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => findFirst.mockReset());

  describe('the three paths do not shadow one another', () => {
    it('serves the crawler document at /preview', async () => {
      findFirst.mockResolvedValue(postRow());
      const res = await request(app.getHttpServer())
        .get(`/api/share/post/${POST_ID}/preview`)
        .expect(200);

      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.text).toContain('property="og:image"');
      expect(res.text).toContain(`${SITE}/post/${POST_ID}`);
    });

    it('serves a real 1200x630 JPEG at /image.jpg', async () => {
      findFirst.mockResolvedValue(postRow());
      const res = await request(app.getHttpServer())
        .get(`/api/share/post/${POST_ID}/image.jpg?v=123`)
        // superagent parses an unknown content type as text by default, which
        // corrupts binary. `blob` gives the bytes back as a Buffer.
        .responseType('blob')
        .expect(200);

      expect(res.headers['content-type']).toBe('image/jpeg');
      const body = res.body as Buffer;
      // SOI marker, then the frame header's own idea of the dimensions.
      expect(body.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
      expect(jpegSize(body)).toEqual({ width: 1200, height: 630 });
    });

    it('serves a full 1080x1920 story canvas at /story.png', async () => {
      // The Instagram path hands this to another application as a file. Filling
      // the story canvas exactly is what stops Instagram deciding for itself
      // what surrounds the image — see renderStory.
      findFirst.mockResolvedValue(postRow());
      const res = await request(app.getHttpServer())
        .get(`/api/share/post/${POST_ID}/story.png`)
        .responseType('blob')
        .expect(200);

      expect(res.headers['content-type']).toBe('image/png');
      const body = res.body as Buffer;
      expect(body.subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
      // 9:16 exactly, at the resolution Instagram stores a story at.
      expect(body.readUInt32BE(16)).toBe(1080);
      expect(body.readUInt32BE(20)).toBe(1920);
    });

    it('refuses the story image for a post that may not be shared', async () => {
      findFirst.mockResolvedValue(null);
      const res = await request(app.getHttpServer())
        .get(`/api/share/post/${POST_ID}/story.png`)
        .expect(404);
      expect(res.headers['cache-control']).toContain('no-store');
    });

    it('serves JSON at the bare post path', async () => {
      findFirst.mockResolvedValue(postRow());
      const res = await request(app.getHttpServer())
        .get(`/api/share/post/${POST_ID}`)
        .expect(200);

      expect(res.body.available).toBe(true);
      expect(res.body.post.id).toBe(POST_ID);
    });
  });

  describe('cache headers survive the global interceptor', () => {
    it('lets the CDN hold the card for a year, keyed by the versioned URL', async () => {
      findFirst.mockResolvedValue(postRow());
      const res = await request(app.getHttpServer()).get(
        `/api/share/post/${POST_ID}/image.jpg?v=123`,
      );

      expect(res.headers['cache-control']).toContain('immutable');
      expect(res.headers['cache-control']).toContain('max-age=31536000');
    });

    it('lets the CDN hold the document briefly, and revalidate in the background', async () => {
      findFirst.mockResolvedValue(postRow());
      const res = await request(app.getHttpServer()).get(
        `/api/share/post/${POST_ID}/preview`,
      );

      expect(res.headers['cache-control']).toContain('s-maxage=300');
      expect(res.headers['cache-control']).toContain('stale-while-revalidate');
    });

    it('never caches a refusal, so a deleted post stops previewing immediately', async () => {
      findFirst.mockResolvedValue(null);

      for (const path of [
        `/api/share/post/${POST_ID}/preview`,
        `/api/share/post/${POST_ID}/image.jpg`,
        `/api/share/post/${POST_ID}`,
      ]) {
        const res = await request(app.getHttpServer()).get(path).expect(404);
        expect(res.headers['cache-control']).toContain('no-store');
      }
    });
  });

  describe('a post that may not be shared', () => {
    beforeEach(() => findFirst.mockResolvedValue(null));

    it('leaks nothing through any of the three surfaces', async () => {
      const doc = await request(app.getHttpServer())
        .get(`/api/share/post/${POST_ID}/preview`)
        .expect(404);
      expect(doc.text).not.toContain(POST_ID);
      expect(doc.text).not.toContain('og:image');

      const image = await request(app.getHttpServer())
        .get(`/api/share/post/${POST_ID}/image.jpg`)
        .expect(404);
      expect(image.body).toEqual({});

      const json = await request(app.getHttpServer())
        .get(`/api/share/post/${POST_ID}`)
        .expect(404);
      expect(json.body).toEqual({ available: false });
    });

    it('treats a malformed id exactly the same, without querying', async () => {
      await request(app.getHttpServer())
        .get('/api/share/post/not-a-uuid')
        .expect(404);
      await request(app.getHttpServer())
        .get('/api/share/post/not-a-uuid/preview')
        .expect(404);
      expect(findFirst).not.toHaveBeenCalled();
    });
  });

  describe('the card survives whatever the post is', () => {
    // Each of these once produced a broken or overflowing card. They render
    // through the real compositor here, so a layout that throws is a failure.
    const shapes: [string, any][] = [
      ['a post with no text at all', { text: '' }],
      ['two thousand characters', { text: 'x'.repeat(2000) }],
      ['one unbroken two-thousand-character word', { text: 'a'.repeat(2000) }],
      [
        'a name that tries to be markup',
        {
          author: {
            username: 'x',
            displayName: '</text><script>a</script>',
            avatar: null,
            updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          },
        },
      ],
      ['a right-to-left override in the text', { text: 'safe\u202egnp.exe' }],
      ['emoji only', { text: '🎉🏆🥳' }],
      ['a community name', { community: { name: 'Design Club' } }],

      // --- every content type the app can produce -----------------------
      [
        'a single image',
        { media: [mediaRow()], _count: { media: 1, pollOptions: 0 } },
      ],
      [
        'a gallery of six',
        {
          media: Array.from({ length: 6 }, (_, i) =>
            mediaRow({ objectKey: `posts/p${i}.webp` }),
          ),
          _count: { media: 6, pollOptions: 0 },
        },
      ],
      [
        'a gallery with no caption',
        {
          text: '',
          media: [mediaRow(), mediaRow({ objectKey: 'posts/b.webp' })],
          _count: { media: 2, pollOptions: 0 },
        },
      ],
      [
        'a single video',
        {
          media: [
            mediaRow({
              objectKey: 'posts/clip.mp4',
              mimeType: 'video/mp4',
              type: 'VIDEO',
            }),
          ],
          _count: { media: 1, pollOptions: 0 },
        },
      ],
      [
        'two videos',
        {
          media: [
            mediaRow({
              objectKey: 'a.mp4',
              mimeType: 'video/mp4',
              type: 'VIDEO',
            }),
            mediaRow({
              objectKey: 'b.mp4',
              mimeType: 'video/mp4',
              type: 'VIDEO',
            }),
          ],
          _count: { media: 2, pollOptions: 0 },
        },
      ],
      [
        'mixed media whose FIRST item is the video',
        {
          media: [
            mediaRow({
              objectKey: 'a.mp4',
              mimeType: 'video/mp4',
              type: 'VIDEO',
            }),
            mediaRow({ objectKey: 'posts/after.webp' }),
          ],
          _count: { media: 2, pollOptions: 0 },
        },
      ],
      [
        'a poll',
        {
          text: 'Which day works best for the trip?',
          pollOptions: [
            { text: 'Friday evening' },
            { text: 'Saturday morning' },
            { text: 'Sunday, all day' },
          ],
          _count: { media: 0, pollOptions: 3 },
        },
      ],
      [
        'a poll with more options than fit',
        {
          text: 'Pick one',
          pollOptions: Array.from({ length: 4 }, (_, i) => ({
            text: `Option ${i}`,
          })),
          _count: { media: 0, pollOptions: 9 },
        },
      ],
      [
        'a poll whose question and options are all far too long',
        {
          text: 'Q'.repeat(900),
          pollOptions: Array.from({ length: 4 }, () => ({
            text: 'answer '.repeat(60),
          })),
          _count: { media: 0, pollOptions: 4 },
        },
      ],
      [
        'a poll that also carries a photograph',
        {
          text: 'Does this make sense?',
          media: [mediaRow()],
          pollOptions: [{ text: 'Yes' }, { text: 'No' }],
          _count: { media: 1, pollOptions: 2 },
        },
      ],
      [
        'an unreachable image',
        {
          media: [mediaRow({ objectKey: 'posts/missing.webp' })],
          _count: { media: 3, pollOptions: 0 },
        },
      ],
      [
        'media the renderer cannot decode',
        {
          media: [mediaRow({ mimeType: 'image/svg+xml' })],
          _count: { media: 1, pollOptions: 0 },
        },
      ],
    ];

    it.each(shapes)('renders %s at full size', async (_label, over) => {
      findFirst.mockResolvedValue(postRow(over));
      const res = await request(app.getHttpServer())
        .get(`/api/share/post/${POST_ID}/image.jpg`)
        .responseType('blob')
        .expect(200);

      expect(jpegSize(res.body as Buffer)).toEqual({
        width: 1200,
        height: 630,
      });
    });
  });
});

/**
 * Reads a JPEG's real dimensions from its frame header.
 *
 * The point of the assertion is that the endpoint returns an image of the size
 * the metadata promises — `og:image:width` and `og:image:height` are declared
 * as 1200x630, and a card that is not actually that size is laid out wrongly by
 * every platform that trusts them. Reading it out of the bytes is the only
 * check that cannot pass on a response merely claiming to be an image.
 */
function jpegSize(buffer: Buffer): { width: number; height: number } {
  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) throw new Error('not a JPEG segment');
    const marker = buffer[offset + 1];
    // Every SOFn except the three in that range which are not frame headers
    // (0xC4 DHT, 0xC8 JPG, 0xCC DAC) carries height then width at a fixed
    // offset into the segment.
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + buffer.readUInt16BE(offset + 2);
  }
  throw new Error('no JPEG frame header found');
}
