/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import {
  activityShareUrl,
  buildActivityShare,
  buildCommunityShare,
  buildPostShare,
  buildProfileShare,
  countMedia,
  describePost,
  isPoll,
  postShareUrl,
} from '../sharePayload';

/**
 * The links and the copy every share destination is handed.
 *
 * The URL is the part that matters most: `/post/:id` is what the server
 * generates Open Graph metadata for and what the canonical tag names, so a
 * dialog that builds anything else produces a link that previews as a bare URL
 * — or, as one of these dialogs actually did, a link that 404s.
 */
describe('share payloads', () => {
  const author = { displayName: 'Alex Kuriakose', username: 'alexk' };

  describe('canonical urls', () => {
    it('uses the route the application actually has', () => {
      expect(postShareUrl('p1')).toBe('http://localhost:3000/post/p1');
      // The bug this pins: the activity dialog copied `/activity/:id`, which
      // has never been a route in this application, so every activity link
      // anyone shared led to Not Found. The route is `/crew/:id`.
      expect(activityShareUrl('a1')).toBe('http://localhost:3000/crew/a1');
    });

    it('is empty rather than broken when there is no id', () => {
      expect(postShareUrl(undefined)).toBe('');
      expect(activityShareUrl(null)).toBe('');
      expect(buildPostShare({}, author).url).toBe('');
    });
  });

  describe('describing a post', () => {
    const cases = [
      ['text only', { text: 'hello' }, 'a post'],
      ['one image', { imageCount: 1, videoCount: 0 }, 'a photo'],
      ['a gallery', { imageCount: 4, videoCount: 0 }, '4 photos'],
      ['one video', { imageCount: 0, videoCount: 1 }, 'a video'],
      ['two videos', { imageCount: 0, videoCount: 2 }, '2 videos'],
      ['mixed media', { imageCount: 3, videoCount: 1 }, 'a video and photos'],
      ['a poll', { isPoll: true, imageCount: 2 }, 'a poll'],
    ];

    it.each(cases)('calls %s "%s"', (_label, post, expected) => {
      expect(describePost(post)).toBe(expected);
    });

    it('matches the wording the server puts in og:title', () => {
      // `SharePreviewService.noun` is the other half of this. They are two
      // languages and cannot share a function, so they share their cases
      // instead — the text a person sends and the title a crawler reads must
      // describe the same thing.
      expect(describePost({ imageCount: 4 })).toBe('4 photos');
      expect(describePost({ videoCount: 1, imageCount: 2 })).toBe(
        'a video and photos',
      );
    });
  });

  describe('counting media across the shapes this app uses', () => {
    it('reads counts the server already computed', () => {
      expect(countMedia({ imageCount: 3, videoCount: 1 })).toEqual({
        images: 3,
        videos: 1,
      });
    });

    it('reads a feed row’s media array', () => {
      expect(
        countMedia({
          media: [
            { mimeType: 'image/webp', objectKey: 'posts/a.webp' },
            { mimeType: 'video/mp4', objectKey: 'posts/b.mp4' },
          ],
        }),
      ).toEqual({ images: 1, videos: 1 });
    });

    it('ignores derived thumbnails, as the server does', () => {
      // A post attachment is stored as TWO Media rows — the original and a
      // `_thumb.webp` variant — so counting both reports a gallery of two as
      // four, and the share text says so.
      expect(
        countMedia({
          media: [
            { mimeType: 'image/webp', objectKey: 'posts/a.webp' },
            { mimeType: 'image/webp', objectKey: 'posts/a_thumb.webp' },
            { mimeType: 'image/webp', objectKey: 'posts/b.webp' },
            { mimeType: 'image/webp', objectKey: 'posts/b_thumb.webp' },
          ],
        }),
      ).toEqual({ images: 2, videos: 0 });
    });

    it('classifies by extension when there is no mime type', () => {
      expect(countMedia({ media: ['posts/clip.mp4', 'posts/pic.webp'] })).toEqual({
        images: 1,
        videos: 1,
      });
    });

    it('handles the oldest shape, a single image on the post', () => {
      expect(countMedia({ mediaUrl: '/api/media/posts/x.webp' })).toEqual({
        images: 1,
        videos: 0,
      });
    });

    it('returns zeroes rather than throwing on nothing at all', () => {
      expect(countMedia(undefined)).toEqual({ images: 0, videos: 0 });
      expect(countMedia({ media: null })).toEqual({ images: 0, videos: 0 });
    });
  });

  describe('recognising a poll', () => {
    it('accepts every shape the app passes around', () => {
      expect(isPoll({ isPoll: true })).toBe(true);
      expect(isPoll({ poll: { question: 'x' } })).toBe(true);
      expect(isPoll({ pollOptions: [{ text: 'a' }] })).toBe(true);
      expect(isPoll({ text: 'not a poll' })).toBe(false);
      expect(isPoll({ pollOptions: [] })).toBe(false);
    });
  });

  describe('the text that travels with a link', () => {
    it('leads with the post, not with boilerplate', () => {
      const payload = buildPostShare(
        { id: 'p1', text: 'Badminton at six on the north court.' },
        author,
      );
      expect(payload.text).toBe('Badminton at six on the north court.');
      expect(payload.title).toContain('Alex Kuriakose');
    });

    it('leads a poll with its question', () => {
      const payload = buildPostShare(
        { id: 'p1', text: 'Where after exams?', isPoll: true },
        author,
      );
      expect(payload.text).toBe('Where after exams?');
    });

    it('says what a captionless post is', () => {
      expect(
        buildPostShare({ id: 'p1', text: '', imageCount: 3 }, author).text,
      ).toBe('See 3 photos by Alex Kuriakose on Meetifyy.');
      expect(
        buildPostShare({ id: 'p1', text: '', videoCount: 1 }, author).text,
      ).toBe('See a video by Alex Kuriakose on Meetifyy.');
    });

    it('sends a teaser, never the whole post', () => {
      const payload = buildPostShare(
        { id: 'p1', text: 'word '.repeat(400) },
        author,
      );
      expect(payload.text.length).toBeLessThanOrEqual(140);
      expect(payload.text.endsWith('…')).toBe(true);
    });

    it('never shows "undefined" when the author is unknown', () => {
      expect(buildPostShare({ id: 'p1' }, null).title).toContain('Someone');
      expect(
        buildPostShare({ id: 'p1', author: { username: 'zed' } }, null).title,
      ).toContain('zed');
    });
  });

  describe('the other shareable things', () => {
    it('builds a profile payload', () => {
      const payload = buildProfileShare({
        username: 'alexk',
        displayName: 'Alex Kuriakose',
      });
      expect(payload.url).toBe('http://localhost:3000/profile/alexk');
      expect(payload.title).toBe('Alex Kuriakose on Meetifyy');
    });

    it('builds a community payload', () => {
      const payload = buildCommunityShare({ id: 'c1', name: 'Design Club' });
      expect(payload.url).toBe('http://localhost:3000/communities/c1');
      expect(payload.title).toBe('Design Club on Meetifyy');
    });

    it('builds an activity payload with its time, when there is one', () => {
      const payload = buildActivityShare({
        id: 'a1',
        title: 'Badminton doubles',
        dateLabel: 'Saturday',
        time: '6pm',
      });
      expect(payload.url).toBe('http://localhost:3000/crew/a1');
      expect(payload.text).toContain('Saturday, 6pm');
    });

    it('does not invent a time an activity does not have', () => {
      const payload = buildActivityShare({ id: 'a1', title: 'Badminton' });
      expect(payload.text).toBe('Join Badminton on Meetifyy.');
    });
  });
});
