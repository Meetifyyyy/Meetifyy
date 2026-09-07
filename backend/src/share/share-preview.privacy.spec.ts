import { SharePreviewService } from './share-preview.service';
import {
  pollPost,
  postWithImages,
  postWithVideos,
  sharePost,
} from './testing/share-post.fixture';

/**
 * What the public internet may see, and which asset it sees.
 *
 * This is the security test for the whole sharing feature. Every externally
 * reachable surface — the crawler document, the OG image, the signed-out post
 * page — reads through `getPublicPost`, so the rules asserted here are the only
 * thing standing between a private post and a permanently cached WhatsApp
 * preview of it.
 *
 * The gate is asserted against the query it BUILDS rather than against rows it
 * happens to get back. That is deliberate: a filter expressed as a WHERE clause
 * cannot be bypassed by a row arriving from somewhere unexpected, and asserting
 * on the clause is what catches someone quietly relaxing it later.
 */
describe('SharePreviewService — what may be shared publicly', () => {
  const POST_ID = '11111111-2222-4333-8444-555555555555';

  const media = (over: any = {}) => ({
    objectKey: 'posts/cat.webp',
    mimeType: 'image/webp',
    type: 'IMAGE',
    width: 1200,
    height: 900,
    visibility: 'public',
    ...over,
  });

  const video = (over: any = {}) =>
    media({
      objectKey: 'posts/clip.mp4',
      mimeType: 'video/mp4',
      type: 'VIDEO',
      width: 1280,
      height: 720,
      ...over,
    });

  const row = (over: any = {}) => ({
    id: POST_ID,
    text: 'Badminton at six.',
    createdAt: new Date('2026-01-02T03:04:05.000Z'),
    updatedAt: new Date('2026-01-02T03:04:05.000Z'),
    author: {
      username: 'alex',
      displayName: 'Alex',
      avatar: null,
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    },
    community: null,
    media: [],
    pollOptions: [],
    _count: { media: 0, pollOptions: 0 },
    ...over,
  });

  const setup = (result: any = row()) => {
    const findFirst = jest.fn().mockResolvedValue(result);
    const prisma: any = { post: { findFirst } };
    const storage: any = {
      getPublicUrl: (key: string) => `https://cdn.example/${key}`,
      isAlwaysPrivateKey: (key: string) => key.startsWith('verification/'),
    };
    const mediaCleanup: any = {
      variantKeysFor: (key: string) => {
        const match = key.match(/^([a-z-]+)\/(.+)\.(\w+)$/i);
        return match ? [key, `${match[1]}/${match[2]}_thumb.webp`] : [key];
      },
    };
    return {
      service: new SharePreviewService(prisma, storage, mediaCleanup),
      findFirst,
    };
  };

  const selectOf = (findFirst: jest.Mock) => findFirst.mock.calls[0][0].select;

  describe('the query refuses, rather than the code filtering afterwards', () => {
    it('requires the post to be live and the author to be an available, active account', async () => {
      const { service, findFirst } = setup();
      await service.getPublicPost(POST_ID);

      expect(findFirst.mock.calls[0][0].where).toMatchObject({
        id: POST_ID,
        deletedAt: null,
        author: { deletedAt: null, accountStatus: 'ACTIVE' },
      });
    });

    it('admits a post with no community, or one in a public, live, non-campus community', async () => {
      const { service, findFirst } = setup();
      await service.getPublicPost(POST_ID);

      expect(findFirst.mock.calls[0][0].where.OR).toEqual([
        { communityId: null },
        {
          community: {
            deletedAt: null,
            isPrivate: false,
            isCampusCommunity: false,
          },
        },
      ]);
    });

    it('answers everything in one round trip', async () => {
      // The gallery, the counts, the poll and the author all come back from the
      // same call. This runs on an unauthenticated, crawler-facing path where
      // fetches arrive in bursts; a second query here is a second query per
      // unfurl, per device, forever.
      const { service, findFirst } = setup();
      await service.getPublicPost(POST_ID);

      expect(findFirst).toHaveBeenCalledTimes(1);
      const select = selectOf(findFirst);
      expect(select.media).toBeDefined();
      expect(select.pollOptions).toBeDefined();
      expect(select._count).toBeDefined();
      expect(select.author).toBeDefined();
    });

    it('reads a bounded window of media, ordered as the post renders', async () => {
      const { service, findFirst } = setup();
      await service.getPublicPost(POST_ID);

      const select = selectOf(findFirst);
      expect(select.media.orderBy).toEqual([{ order: 'asc' }, { id: 'asc' }]);
      expect(select.media.take).toBeGreaterThan(1); // enough to choose from
      expect(select.media.take).toBeLessThanOrEqual(12); // never unbounded
      expect(select.pollOptions.take).toBeLessThanOrEqual(8);
    });

    it('counts attachments, not the derived thumbnails stored beside them', async () => {
      // Every post attachment is TWO Media rows — the original and a
      // `<key>_thumb.webp` variant sharing its postId. The thumb rows also all
      // carry `order: 0`, so without this filter they sort ahead of the real
      // gallery and the primary image is whichever thumb happened to win.
      const { service, findFirst } = setup();
      await service.getPublicPost(POST_ID);

      const select = selectOf(findFirst);
      const originalsOnly = { NOT: { objectKey: { endsWith: '_thumb.webp' } } };

      expect(select.media.where).toEqual(originalsOnly);
      // The same filter on both, so the count and the pick cannot disagree.
      expect(select._count.select.media).toEqual({ where: originalsOnly });
    });

    it('never selects a column that would leak a viewer relationship or private field', async () => {
      const { service, findFirst } = setup();
      await service.getPublicPost(POST_ID);

      const select = selectOf(findFirst);
      expect(select.author.select).toEqual({
        username: true,
        displayName: true,
        avatar: true,
        updatedAt: true,
      });
      expect(select.likeCount).toBeUndefined();
      expect(select.comments).toBeUndefined();
      expect(select.pollVotes).toBeUndefined();
      expect(select.bookmarks).toBeUndefined();
    });

    it('never reads how anyone voted, or how many did', async () => {
      // Not a stylistic omission. A vote count on the card would be frozen: the
      // card is cached against the post's `updatedAt`, and casting a vote does
      // not move it. And it is other people's choices, which is not part of
      // what sharing a link should publish.
      const { service, findFirst } = setup();
      await service.getPublicPost(POST_ID);

      const select = selectOf(findFirst);
      expect(select.pollOptions.select).toEqual({ text: true });
      expect(select.pollVotes).toBeUndefined();
    });
  });

  describe('failures are indistinguishable from one another', () => {
    it('returns null when the query matches nothing', async () => {
      const { service } = setup(null);
      await expect(service.getPublicPost(POST_ID)).resolves.toBeNull();
    });

    it('returns null for a malformed id without touching the database', async () => {
      const { service, findFirst } = setup();
      await expect(service.getPublicPost('not-a-uuid')).resolves.toBeNull();
      await expect(service.getPublicPost('')).resolves.toBeNull();
      expect(findFirst).not.toHaveBeenCalled();
    });
  });

  describe('choosing the preview asset', () => {
    it('prefers a photograph over a video, wherever the video sits in the gallery', async () => {
      // The bug this pins: reading only `media[0]` meant a post whose first
      // attachment was a video previewed as though it had no media, even with
      // ten photographs behind it. An unfurler cannot play a video, so a
      // photograph is always the better answer.
      const { service } = setup(
        row({
          media: [video(), media({ objectKey: 'posts/second.webp' })],
          _count: { media: 2, pollOptions: 0 },
        }),
      );

      const post = await service.getPublicPost(POST_ID);
      expect(post?.mediaKind).toBe('image');
      expect(post?.image?.url).toBe('https://cdn.example/posts/second.webp');
      expect(post?.video?.url).toBe('https://cdn.example/posts/clip.mp4');
      expect(post?.imageCount).toBe(1);
      expect(post?.videoCount).toBe(1);
    });

    it('keeps the gallery in the post’s own order', async () => {
      const { service } = setup(
        row({
          media: [
            media({ objectKey: 'posts/a.webp' }),
            media({ objectKey: 'posts/b.webp' }),
            media({ objectKey: 'posts/c.webp' }),
          ],
          _count: { media: 3, pollOptions: 0 },
        }),
      );

      const post = await service.getPublicPost(POST_ID);
      expect(post?.gallery.map((g) => g.url)).toEqual([
        'https://cdn.example/posts/a.webp',
        'https://cdn.example/posts/b.webp',
        'https://cdn.example/posts/c.webp',
      ]);
      // The canonical single preview is the first, because every platform shows
      // exactly one.
      expect(post?.image).toEqual(post?.gallery[0]);
    });

    it('is deterministic: the same rows always give the same card', async () => {
      const rows = row({
        media: [video(), media({ objectKey: 'posts/x.webp' })],
        _count: { media: 2, pollOptions: 0 },
      });
      const a = await setup(rows).service.getPublicPost(POST_ID);
      const b = await setup(rows).service.getPublicPost(POST_ID);
      expect(a).toEqual(b);
    });

    it('caps the gallery so a large post cannot become a large render', async () => {
      const { service } = setup(
        row({
          media: Array.from({ length: 10 }, (_, i) =>
            media({ objectKey: `posts/${i}.webp` }),
          ),
          _count: { media: 10, pollOptions: 0 },
        }),
      );

      const post = await service.getPublicPost(POST_ID);
      expect(post?.gallery).toHaveLength(3);
      // The cap is on what is DRAWN, not on what is reported: the copy still
      // says there are ten.
      expect(post?.imageCount).toBe(10);
    });

    it('offers both an optimised and an original URL for every image', async () => {
      const { service } = setup(
        row({ media: [media()], _count: { media: 1, pollOptions: 0 } }),
      );
      const post = await service.getPublicPost(POST_ID);

      // Original preferred for a post photograph — the card's panel is larger
      // than the ~480px grid thumb, so preferring the thumb upscales.
      expect(post?.image?.url).toBe('https://cdn.example/posts/cat.webp');
      expect(post?.image?.fallbackUrl).toBe(
        'https://cdn.example/posts/cat_thumb.webp',
      );
    });
  });

  describe('video', () => {
    it('is described, not decoded', async () => {
      const { service } = setup(
        row({ media: [video()], _count: { media: 1, pollOptions: 0 } }),
      );
      const post = await service.getPublicPost(POST_ID);

      expect(post?.mediaKind).toBe('video');
      expect(post?.image).toBeNull();
      expect(post?.video).toEqual({
        url: 'https://cdn.example/posts/clip.mp4',
        mimeType: 'video/mp4',
        width: 1280,
        height: 720,
        posterUrl: 'https://cdn.example/posts/clip_thumb.webp',
      });
    });

    it('offers a poster key even though the pipeline does not produce one', async () => {
      // Deliberate. There is no poster frame for an mp4 in this pipeline, so
      // this is where one WOULD live; the renderer treats it as a guess that is
      // allowed to 404. It costs one cheap request and means posters start
      // working by themselves if the uploader ever writes them.
      const { service } = setup(
        row({ media: [video()], _count: { media: 1, pollOptions: 0 } }),
      );
      const post = await service.getPublicPost(POST_ID);
      expect(post?.video?.posterUrl).toMatch(/_thumb\.webp$/);
    });

    it('counts several videos without pretending one is an image', async () => {
      const { service } = setup(
        row({
          media: [video(), video({ objectKey: 'posts/clip2.mp4' })],
          _count: { media: 2, pollOptions: 0 },
        }),
      );
      const post = await service.getPublicPost(POST_ID);

      expect(post?.videoCount).toBe(2);
      expect(post?.imageCount).toBe(0);
      expect(post?.mediaKind).toBe('video');
      // The first video, deterministically.
      expect(post?.video?.url).toBe('https://cdn.example/posts/clip.mp4');
    });
  });

  describe('media the preview may not or cannot use', () => {
    it('drops a row marked private', async () => {
      const { service } = setup(
        row({
          media: [media({ visibility: 'private' })],
          _count: { media: 1, pollOptions: 0 },
        }),
      );
      const post = await service.getPublicPost(POST_ID);
      expect(post?.image).toBeNull();
      expect(post?.imageCount).toBe(0);
    });

    it('never serves anything under the verification prefix', async () => {
      const { service } = setup(
        row({
          media: [media({ objectKey: 'verification/id-card.webp' })],
          _count: { media: 1, pollOptions: 0 },
        }),
      );
      expect((await service.getPublicPost(POST_ID))?.image).toBeNull();
    });

    it('refuses a format the renderer cannot decode, rather than throwing later', async () => {
      // SVG is excluded on purpose: it is a document that can reference remote
      // resources, and rasterising a user-supplied one inside a request is a
      // problem this feature has no reason to take on.
      const { service } = setup(
        row({
          media: [media({ mimeType: 'image/svg+xml' })],
          _count: { media: 1, pollOptions: 0 },
        }),
      );
      expect((await service.getPublicPost(POST_ID))?.image).toBeNull();
    });

    it('accepts the uppercase type the database actually stores', async () => {
      const { service } = setup(
        row({
          media: [media({ type: 'IMAGE' })],
          _count: { media: 1, pollOptions: 0 },
        }),
      );
      expect((await service.getPublicPost(POST_ID))?.image).not.toBeNull();
    });
  });

  describe('polls', () => {
    it('carries the options, in ballot order, without their counts', async () => {
      const { service } = setup(
        row({
          text: 'Where after exams?',
          pollOptions: [{ text: 'Beach' }, { text: 'Cafe' }],
          _count: { media: 0, pollOptions: 2 },
        }),
      );
      const post = await service.getPublicPost(POST_ID);

      expect(post?.isPoll).toBe(true);
      expect(post?.pollOptions).toEqual(['Beach', 'Cafe']);
      expect(post?.pollOptionCount).toBe(2);
      expect(JSON.stringify(post)).not.toContain('voteCount');
    });

    it('reports the real option count even when the list is capped', async () => {
      const { service } = setup(
        row({
          pollOptions: [
            { text: 'A' },
            { text: 'B' },
            { text: 'C' },
            { text: 'D' },
          ],
          _count: { media: 0, pollOptions: 9 },
        }),
      );
      const post = await service.getPublicPost(POST_ID);
      expect(post?.pollOptions).toHaveLength(4);
      expect(post?.pollOptionCount).toBe(9);
    });
  });

  describe('avatars', () => {
    it('prefers the thumbnail variant the upload pipeline already produces', async () => {
      const { service } = setup(
        row({
          author: {
            username: 'alex',
            displayName: 'Alex',
            avatar: 'avatars/abc.webp',
            updatedAt: new Date(),
          },
        }),
      );
      const post = await service.getPublicPost(POST_ID);
      // Opposite preference to a post photograph, and correctly so: this is
      // drawn at 88px, where the thumb is already larger than the target.
      expect(post?.author.avatarUrl).toBe(
        'https://cdn.example/avatars/abc_thumb.webp',
      );
    });

    it('accepts an absolute avatar URL unchanged', async () => {
      const { service } = setup(
        row({
          author: {
            username: 'alex',
            displayName: 'Alex',
            avatar: 'https://cdn.example/avatars/legacy.webp',
            updatedAt: new Date(),
          },
        }),
      );
      expect((await service.getPublicPost(POST_ID))?.author.avatarUrl).toBe(
        'https://cdn.example/avatars/legacy.webp',
      );
    });

    it('reports no avatar when the user has none, so the default is used', async () => {
      const { service } = setup();
      expect(
        (await service.getPublicPost(POST_ID))?.author.avatarUrl,
      ).toBeNull();
    });
  });

  describe('metadata derived from a post', () => {
    it('caps the description well short of the post itself', () => {
      const description = SharePreviewService.description(
        sharePost({ text: 'word '.repeat(400) }),
      );
      expect(description.length).toBeLessThanOrEqual(
        SharePreviewService.DESCRIPTION_MAX_CHARS,
      );
      expect(description.endsWith('…')).toBe(true);
    });

    it('names what the post actually is', () => {
      const cases: [ReturnType<typeof sharePost>, string][] = [
        [sharePost(), 'a post'],
        [postWithImages(1), 'a photo'],
        [postWithImages(4), '4 photos'],
        [postWithVideos(1), 'a video'],
        [postWithVideos(2), '2 videos'],
        [
          postWithImages(3, { videoCount: 1 }),
          'a video and photos',
        ],
        [pollPost(['A', 'B']), 'a poll'],
      ];

      for (const [post, noun] of cases) {
        expect(SharePreviewService.title(post, 'Meetifyy')).toBe(
          `Alex Kuriakose shared ${noun} on Meetifyy`,
        );
      }
    });

    it('leads a poll with its question and says how many ways there are to answer', () => {
      const description = SharePreviewService.description(
        pollPost(['Beach', 'Cafe', 'Home']),
      );
      expect(description).toContain(
        'Where are we hanging out after exams end?',
      );
      expect(description).toContain('3 options');
      // Never a tally.
      expect(description).not.toMatch(/\d+\s*votes?/i);
    });

    it('says something rather than nothing for a post with no text', () => {
      expect(
        SharePreviewService.description(postWithImages(1, { text: '' })),
      ).toContain('photo');
      expect(
        SharePreviewService.description(postWithImages(5, { text: '' })),
      ).toContain('5 photos');
      expect(
        SharePreviewService.description(postWithVideos(1, { text: '' })),
      ).toContain('video');
    });

    it('falls back to the handle when a display name is blank', () => {
      expect(
        SharePreviewService.title(
          sharePost({
            author: { username: 'alex', displayName: '   ', avatarUrl: null },
          }),
          'Meetifyy',
        ),
      ).toBe('@alex shared a post on Meetifyy');
    });
  });

  describe('the version token', () => {
    it('moves when the post is edited', () => {
      expect(SharePreviewService.versionToken(sharePost())).not.toBe(
        SharePreviewService.versionToken(
          sharePost({ updatedAt: new Date('2027-01-01') }),
        ),
      );
    });

    it('moves when the author renames themselves', () => {
      // The post's own `updatedAt` cannot see a rename, so without the author's
      // the card kept the old display name on every shared link until either
      // the post was edited or the cache expired.
      expect(SharePreviewService.versionToken(sharePost())).not.toBe(
        SharePreviewService.versionToken(
          sharePost({ authorUpdatedAt: new Date('2027-01-01') }),
        ),
      );
    });

    it('is stable for an unchanged post', () => {
      expect(SharePreviewService.versionToken(sharePost())).toBe(
        SharePreviewService.versionToken(sharePost()),
      );
    });
  });
});
