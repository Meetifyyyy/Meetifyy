/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INSTAGRAM_MODE,
  instagramHint,
  instagramLabel,
  resolveInstagramMode,
  shareToInstagram,
} from '../instagram';

/**
 * The capability question, and the three answers.
 *
 * This is the file that decides what the Instagram button says and what it
 * does, and every one of its inputs is a browser feature rather than a user
 * agent. The failure this suite exists to prevent is a tile that promises a
 * Story on a device that cannot send one — which is not cosmetic: it is the
 * difference between somebody landing in the story composer and somebody
 * landing in a direct message wondering what happened.
 */
describe('Instagram', () => {
  const payload = {
    url: 'https://meetifyy.app/post/abc',
    title: 'See a post by alexk on Meetifyy',
    text: 'See a post by alexk on Meetifyy',
    cardImageUrl: 'https://meetifyy.app/api/share/post/abc/story.jpg',
    cardFileName: 'meetifyy-story.jpg',
  };

  const card = () =>
    new File([new Blob(['jpeg'])], 'meetifyy-story.jpg', { type: 'image/jpeg' });

  /** A browser with Web Share Level 2 — Chrome on Android, Safari on iOS. */
  const withFileSharing = () => {
    navigator.share = vi.fn().mockResolvedValue(undefined);
    navigator.canShare = vi.fn().mockReturnValue(true);
  };

  /** A browser with Level 1 only: a share sheet, but no files. */
  const withLinkSharingOnly = () => {
    navigator.share = vi.fn().mockResolvedValue(undefined);
    navigator.canShare = vi.fn((data) => !data?.files);
  };

  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
  });

  afterEach(() => {
    delete navigator.share;
    delete navigator.canShare;
    vi.restoreAllMocks();
  });

  describe('resolving what this device can do', () => {
    it('offers a Story only with file sharing AND a card', () => {
      withFileSharing();
      expect(resolveInstagramMode(payload)).toBe(INSTAGRAM_MODE.STORY);
    });

    it('does not offer a Story for something with no card', () => {
      // A profile, community or activity. The device could send a file; there
      // is no file to send, and saying "Instagram Story" here would be a
      // promise nothing can keep.
      withFileSharing();
      const { cardImageUrl, ...noCard } = payload;
      expect(resolveInstagramMode(noCard)).toBe(INSTAGRAM_MODE.LINK);
    });

    it('does not offer a Story where files cannot be shared', () => {
      withLinkSharingOnly();
      expect(resolveInstagramMode(payload)).toBe(INSTAGRAM_MODE.LINK);
    });

    it('falls back to copying where there is no share sheet at all', () => {
      // Every desktop browser this app is used on. Verified at runtime in
      // Chromium on Linux: `navigator.share` is undefined.
      expect(resolveInstagramMode(payload)).toBe(INSTAGRAM_MODE.COPY);
    });
  });

  describe('what the button says', () => {
    it('names a Story only when a Story is on offer', () => {
      expect(instagramLabel(INSTAGRAM_MODE.STORY)).toBe('Instagram Story');
      expect(instagramLabel(INSTAGRAM_MODE.LINK)).toBe('Instagram');
      expect(instagramLabel(INSTAGRAM_MODE.COPY)).toBe('Instagram');
    });

    it('describes each mode honestly', () => {
      expect(instagramHint(INSTAGRAM_MODE.STORY)).toMatch(/story image/i);
      // The link mode must not imply a story is coming.
      expect(instagramHint(INSTAGRAM_MODE.LINK)).toMatch(/direct message/i);
      // It has to say there is NO story here, not merely omit the word.
      expect(instagramHint(INSTAGRAM_MODE.LINK)).toMatch(/no story card/i);
      expect(instagramHint(INSTAGRAM_MODE.COPY)).toMatch(/copy/i);
    });
  });

  describe('performing the share', () => {
    it('sends the card as a file, which is what unlocks Story and Post', async () => {
      withFileSharing();
      const result = await shareToInstagram({
        mode: INSTAGRAM_MODE.STORY,
        card: card(),
        payload,
      });

      expect(result).toEqual({ outcome: 'story', copied: true });
      const sent = navigator.share.mock.calls[0][0];
      expect(sent.files).toHaveLength(1);
      // Files ONLY. Instagram given an image plus a URL can fall back to
      // treating the whole payload as a message — the case this path exists to
      // get away from.
      expect(sent.url).toBeUndefined();
      expect(sent.text).toBeUndefined();
    });

    it('shares without waiting on the clipboard first', async () => {
      // THE regression, and the reason "Add to story" kept not appearing.
      // `clipboard.writeText` settles in a LATER TASK; awaiting it before
      // `share` meant Safari had already spent the tap's transient activation,
      // so `share` threw and the code fell through to the link — which is
      // Instagram Direct and nothing else.
      withFileSharing();
      navigator.clipboard.writeText = vi.fn(() => new Promise(() => {}));

      const result = await shareToInstagram({
        mode: INSTAGRAM_MODE.STORY,
        card: card(),
        payload,
      });

      expect(result.outcome).toBe('story');
      expect(navigator.share).toHaveBeenCalled();
      // Issued before the sheet — it is simply not blocked on. A write that
      // never settles (the document has lost focus to the sheet, which is
      // allowed to leave the promise pending) must not hang the button.
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(payload.url);
      expect(result.copied).toBe(false);
    });

    it('reports a story only once the OS has accepted the handoff', async () => {
      // `navigator.share` rejecting means the platform refused it. Reporting
      // success there would be inventing an outcome we did not observe.
      withFileSharing();
      navigator.share = vi.fn().mockRejectedValue(new Error('nope'));

      const result = await shareToInstagram({
        mode: INSTAGRAM_MODE.STORY,
        card: card(),
        payload,
      });

      expect(result.outcome).not.toBe('story');
      expect(result.outcome).toBe('copied');
    });

    it('treats a cancelled sheet as a change of mind, not a failure', async () => {
      withFileSharing();
      const abort = Object.assign(new Error('cancelled'), { name: 'AbortError' });
      navigator.share = vi.fn().mockRejectedValue(abort);

      const result = await shareToInstagram({
        mode: INSTAGRAM_MODE.STORY,
        card: card(),
        payload,
      });

      expect(result.outcome).toBe('dismissed');
    });

    it('falls back to the link when the card never arrived', async () => {
      withFileSharing();
      const result = await shareToInstagram({
        mode: INSTAGRAM_MODE.STORY,
        card: null,
        payload,
      });

      expect(result.outcome).toBe('link');
      expect(navigator.share).toHaveBeenCalledWith(payload);
    });

    it('copies where there is no share sheet, and says whether it worked', async () => {
      expect(
        await shareToInstagram({ mode: INSTAGRAM_MODE.COPY, payload }),
      ).toEqual({ outcome: 'copied', copied: true });

      navigator.clipboard.writeText = vi.fn().mockRejectedValue(new Error('no'));
      document.execCommand = vi.fn().mockReturnValue(false);
      expect(
        (await shareToInstagram({ mode: INSTAGRAM_MODE.COPY, payload })).outcome,
      ).toBe('failed');
    });
  });
});
