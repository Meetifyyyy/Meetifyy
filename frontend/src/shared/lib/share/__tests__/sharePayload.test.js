/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import {
  activityShareUrl,
  buildActivityShare,
  buildCommunityShare,
  buildPostShare,
  buildProfileShare,
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

  describe('the text that travels with a link', () => {
    /**
     * One fixed line, and the same line in both fields.
     *
     * The payload used to lead with a teaser of the post body. That read well
     * and republished somebody's writing into whatever thread the link was
     * pasted into — a recipient who could not open the post still received its
     * first 140 characters. The message now says whose post it is and nothing
     * else; the card behind `url` is the only thing that shows content, and the
     * server has already checked that post is public before drawing it.
     */
    it('is exactly "See a post by {username} on Meetifyy"', () => {
      const payload = buildPostShare(
        { id: 'p1', text: 'Badminton at six on the north court.' },
        author,
      );
      expect(payload.text).toBe('See a post by alexk on Meetifyy');
      expect(payload.title).toBe(payload.text);
    });

    it('says the same thing whatever the post is', () => {
      // A gallery, a video, a poll and a bare caption all share one line: the
      // shape of the post is the card's business, not the message's.
      for (const post of [
        { id: 'p1', text: '', imageCount: 3 },
        { id: 'p1', text: '', videoCount: 1 },
        { id: 'p1', text: 'Where after exams?', isPoll: true },
        { id: 'p1', media: [{ mimeType: 'video/mp4' }, { mimeType: 'image/webp' }] },
      ]) {
        expect(buildPostShare(post, author).text).toBe(
          'See a post by alexk on Meetifyy',
        );
      }
    });

    it('never carries a word of the post', () => {
      const payload = buildPostShare(
        { id: 'p1', text: 'meet me behind the library at midnight' },
        author,
      );
      expect(payload.text).not.toContain('library');
      expect(payload.title).not.toContain('library');
    });

    it('leaves the canonical link as the only url in the message', () => {
      // The old text quoted the body, so a post containing a link put that link
      // FIRST — and WhatsApp previews the first url it finds. A fixed line
      // cannot carry one at all.
      const payload = buildPostShare(
        { id: 'p1', text: 'look https://example.test/x and https://other.test/y' },
        author,
      );
      const message = `${payload.text} ${payload.url}`;
      expect(message.match(/https?:\/\//g)).toHaveLength(1);
      expect(message).toContain('/post/p1');
    });

    it('names the handle, falling back through the shapes the app passes', () => {
      expect(
        buildPostShare({ id: 'p1', author: { username: 'zed' } }, null).text,
      ).toBe('See a post by zed on Meetifyy');
      // No username anywhere: a display name still beats the word `undefined`.
      expect(buildPostShare({ id: 'p1' }, { displayName: 'Alex K' }).text).toBe(
        'See a post by Alex K on Meetifyy',
      );
      expect(buildPostShare({ id: 'p1' }, null).text).toBe(
        'See a post by someone on Meetifyy',
      );
    });
  });

  it('carries no card image: story cards are drawn on the device now', () => {
    // The old Web Share path fetched a server-rendered story.jpg. The app's
    // native Stories flow renders its own card, and the website offers none.
    expect(buildPostShare({ id: 'p1', text: 'x' }, author).cardImageUrl).toBeUndefined();
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
