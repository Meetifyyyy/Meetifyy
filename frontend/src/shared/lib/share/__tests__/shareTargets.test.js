/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  INSTAGRAM_HINT_COPY,
  INSTAGRAM_HINT_SHEET,
  SHARE_TARGETS,
  canNativeShare,
  copyToClipboard,
  openShareWindow,
  shareNatively,
} from '../shareTargets';

/**
 * The platform URLs, and the two browser APIs sharing depends on.
 *
 * Each URL here is asserted against the documented endpoint for that platform.
 * The failure mode this protects against is quiet: a share button that opens a
 * login wall or a 404 still *looks* like it worked, so nobody reports it.
 */
describe('share targets', () => {
  const payload = {
    url: 'https://meetifyy.app/post/abc',
    title: 'Alex on Meetifyy: Badminton at six',
    text: 'Badminton at six',
  };

  const target = (id) => SHARE_TARGETS.find((t) => t.id === id);
  const params = (url) => new URL(url).searchParams;

  afterEach(() => {
    delete navigator.share;
    delete navigator.canShare;
    vi.restoreAllMocks();
  });

  it('offers exactly the destinations the product asks for, in order', () => {
    // Copy leads deliberately: it is the one destination that cannot fail, and
    // the fallback every other target uses when a popup is blocked or an app is
    // missing.
    expect(SHARE_TARGETS.map((t) => t.id)).toEqual([
      'copy',
      'instagram',
      'whatsapp',
      'x',
      'linkedin',
      'reddit',
    ]);
  });

  describe('WhatsApp', () => {
    it('puts the link inside the message text, where WhatsApp unfurls it', () => {
      // There is no separate url parameter: WhatsApp reads the link out of the
      // text. Adding one produces a message with a stray query string in it.
      const url = target('whatsapp').build(payload);
      expect(url.startsWith('https://api.whatsapp.com/send?')).toBe(true);
      expect(params(url).get('text')).toBe(
        'Badminton at six https://meetifyy.app/post/abc',
      );
    });

    it('sends the bare link when there is nothing to say', () => {
      const url = target('whatsapp').build({ ...payload, text: '' });
      expect(params(url).get('text')).toBe('https://meetifyy.app/post/abc');
    });
  });

  describe('X', () => {
    it('passes the text and the link separately, as the composer expects', () => {
      const url = target('x').build(payload);
      expect(url.startsWith('https://x.com/intent/post?')).toBe(true);
      expect(params(url).get('url')).toBe(payload.url);
      expect(params(url).get('text')).toBe('Badminton at six');
    });

    it('leaves room for the link X always counts as 23 characters', () => {
      const url = target('x').build({ ...payload, text: 'word '.repeat(200) });
      expect(params(url).get('text').length).toBeLessThanOrEqual(280 - 23 - 1);
    });
  });

  describe('LinkedIn', () => {
    it('passes only the url, which is all LinkedIn still honours', () => {
      // LinkedIn retired `title`, `summary` and `source` in 2021 and now builds
      // the post from the page's own Open Graph tags. Sending them anyway would
      // be a promise this code cannot keep.
      const url = target('linkedin').build(payload);
      expect(url.startsWith('https://www.linkedin.com/sharing/share-offsite/?')).toBe(
        true,
      );
      expect([...params(url).keys()]).toEqual(['url']);
      expect(params(url).get('url')).toBe(payload.url);
    });
  });

  describe('Reddit', () => {
    it('prefills the submission with the link and a title', () => {
      const url = target('reddit').build(payload);
      expect(url.startsWith('https://www.reddit.com/submit?')).toBe(true);
      expect(params(url).get('url')).toBe(payload.url);
      expect(params(url).get('title')).toBe(payload.title);
    });

    it('clamps the title Reddit would otherwise reject', () => {
      // Reddit refuses a submission over 300 characters rather than truncating
      // it, so a long caption would fail at the far end with no explanation.
      const url = target('reddit').build({ ...payload, title: 'x'.repeat(500) });
      expect(params(url).get('title').length).toBeLessThanOrEqual(300);
    });
  });

  describe('Instagram', () => {
    it('builds no url, because Instagram has no web share endpoint', () => {
      // Every "Instagram share URL" is a login wall. The button copies the link
      // instead, or hands off to the OS share sheet where there is one.
      expect(target('instagram').build(payload)).toBeNull();
    });

    it('is the only target that needs explaining', () => {
      // It is the only one whose behaviour is not obvious from its name, so it
      // is the only one that carries a hint — and the hint depends on the
      // device, which is why the component resolves it rather than this table.
      expect(SHARE_TARGETS.filter((t) => t.needsHint).map((t) => t.id)).toEqual([
        'instagram',
      ]);
    });

    it('describes the share sheet on a phone and a copy everywhere else', () => {
      // Telling somebody holding a phone that the link "will be copied", a
      // moment before their share sheet opens, is simply untrue.
      expect(INSTAGRAM_HINT_SHEET).toMatch(/share sheet/i);
      expect(INSTAGRAM_HINT_COPY).toMatch(/copy/i);
    });
  });

  describe('opening a share window', () => {
    it('navigates through an anchor that cannot reach back', () => {
      // `window.open(url, '_blank', 'noopener')` returns null ON SUCCESS — that
      // is the spec, not a failure — so a share built on its return value
      // reported every working share as blocked, fell through to copying, and
      // then failed that too because the new tab had taken focus.
      const clicks = [];
      const realCreate = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation((tag) => {
        const el = realCreate(tag);
        if (tag === 'a') {
          el.click = () => clicks.push({ href: el.href, target: el.target, rel: el.rel });
        }
        return el;
      });

      expect(openShareWindow('https://example.test/')).toBe(true);
      expect(clicks).toEqual([
        {
          href: 'https://example.test/',
          target: '_blank',
          rel: 'noopener noreferrer',
        },
      ]);
    });

    it('leaves nothing behind in the document', () => {
      const before = document.body.childElementCount;
      openShareWindow('https://example.test/');
      expect(document.body.childElementCount).toBe(before);
    });

    it('reports failure when the DOM cannot be used at all', () => {
      vi.spyOn(document, 'createElement').mockImplementation(() => {
        throw new Error('detached');
      });
      expect(openShareWindow('https://example.test/')).toBe(false);
    });
  });

  describe('the clipboard', () => {
    const setClipboard = (value) =>
      Object.defineProperty(navigator, 'clipboard', {
        value,
        configurable: true,
        writable: true,
      });

    afterEach(() => {
      setClipboard(undefined);
      delete document.execCommand;
    });

    it('writes through the Clipboard API when it is available', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      setClipboard({ writeText });
      await expect(copyToClipboard('https://meetifyy.app/post/abc')).resolves.toBe(
        true,
      );
      expect(writeText).toHaveBeenCalledWith('https://meetifyy.app/post/abc');
    });

    it('falls back where the Clipboard API does not exist', async () => {
      // `navigator.clipboard` is undefined on any non-secure origin, which
      // includes the LAN addresses used to test on a real phone — exactly where
      // copy-link matters most.
      setClipboard(undefined);
      document.execCommand = vi.fn().mockReturnValue(true);

      await expect(copyToClipboard('x')).resolves.toBe(true);
      expect(document.execCommand).toHaveBeenCalledWith('copy');
      // The scratch element is not left behind in the document.
      expect(document.querySelector('textarea')).toBeNull();
    });

    it('falls back when the Clipboard API is present but refuses', async () => {
      setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('denied')) });
      document.execCommand = vi.fn().mockReturnValue(true);
      await expect(copyToClipboard('x')).resolves.toBe(true);
    });

    it('reports failure rather than claiming a copy that did not happen', async () => {
      setClipboard(undefined);
      document.execCommand = vi.fn(() => {
        throw new Error('unsupported');
      });
      await expect(copyToClipboard('x')).resolves.toBe(false);
    });

    it('does nothing for an empty value', async () => {
      const writeText = vi.fn();
      setClipboard({ writeText });
      await expect(copyToClipboard('')).resolves.toBe(false);
      expect(writeText).not.toHaveBeenCalled();
    });
  });

  describe('the native share sheet', () => {
    it('is unavailable where the API is absent', () => {
      expect(canNativeShare(payload)).toBe(false);
    });

    it('defers to canShare where the browser implements it', () => {
      navigator.share = vi.fn();
      navigator.canShare = vi.fn().mockReturnValue(false);
      expect(canNativeShare(payload)).toBe(false);

      navigator.canShare = vi.fn().mockReturnValue(true);
      expect(canNativeShare(payload)).toBe(true);
    });

    it('reports a dismissal as its own outcome, not as a failure', async () => {
      // An AbortError is what the browser throws when somebody closes the
      // sheet. Treated as an error it produced a failure message every time
      // a user changed their mind.
      const abort = new Error('cancelled');
      abort.name = 'AbortError';
      navigator.share = vi.fn().mockRejectedValue(abort);

      await expect(shareNatively(payload)).resolves.toBe('dismissed');
    });

    it('reports a refusal as unsupported, so the caller can fall back', async () => {
      const denied = new Error('not allowed');
      denied.name = 'NotAllowedError';
      navigator.share = vi.fn().mockRejectedValue(denied);
      await expect(shareNatively(payload)).resolves.toBe('unsupported');
    });

    it('refuses a payload with no url', async () => {
      navigator.share = vi.fn();
      await expect(shareNatively({ title: 'x' })).resolves.toBe('unsupported');
      expect(navigator.share).not.toHaveBeenCalled();
    });
  });
});
