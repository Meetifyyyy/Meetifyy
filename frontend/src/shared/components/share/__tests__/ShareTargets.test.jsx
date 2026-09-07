/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ShareTargets from '../ShareTargets';

/**
 * The share row every dialog ends in.
 *
 * The behaviours worth protecting are the ones that fail quietly: a button that
 * opens nothing, a "Link copied" message over an empty clipboard, and a popup
 * blocker that turns a click into no feedback at all.
 */
describe('<ShareTargets>', () => {
  const payload = {
    url: 'https://meetifyy.app/post/abc',
    title: 'Alex on Meetifyy',
    text: 'Badminton at six',
  };

  const setClipboard = (value) =>
    Object.defineProperty(navigator, 'clipboard', {
      value,
      configurable: true,
      writable: true,
    });

  /** Every anchor the component clicks, in order. */
  let navigations;

  beforeEach(() => {
    setClipboard({ writeText: vi.fn().mockResolvedValue(undefined) });

    // Sharing navigates through a synthetic anchor rather than `window.open` —
    // see openShareWindow for why — so that is what has to be intercepted.
    navigations = [];
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      const el = realCreate(tag);
      if (tag === 'a') {
        el.click = () => navigations.push({ href: el.href, rel: el.rel });
      }
      return el;
    });
  });

  afterEach(() => {
    // This project does not enable vitest globals, so RTL's automatic cleanup
    // is never registered and renders accumulate across tests.
    cleanup();
    setClipboard(undefined);
    delete navigator.share;
    delete navigator.canShare;
    vi.restoreAllMocks();
  });

  it('offers every destination, each with an accessible name', () => {
    render(<ShareTargets payload={payload} />);

    for (const name of ['WhatsApp', 'X', 'LinkedIn', 'Reddit', 'Instagram', 'Copy link']) {
      // Found by its visible label, which IS the accessible name. An aria-label
      // here would override the visible text and break voice control ("click
      // WhatsApp" has to match what is on screen).
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
  });

  it('opens each platform in a tab that cannot reach back', () => {
    render(<ShareTargets payload={payload} />);

    for (const [name, host] of [
      ['WhatsApp', 'api.whatsapp.com'],
      ['X', 'x.com/intent/post'],
      ['LinkedIn', 'linkedin.com/sharing'],
      ['Reddit', 'reddit.com/submit'],
    ]) {
      fireEvent.click(screen.getByRole('button', { name }));
      const last = navigations[navigations.length - 1];
      expect(last.href).toContain(host);
      expect(last.rel).toBe('noopener noreferrer');
    }
  });

  it('does not fall back to copying when the share actually opened', () => {
    // The failure this pins: a share that worked used to report "Could not copy
    // the link", because the open was misread as blocked and the copy that
    // followed was refused by a document that had just lost focus.
    render(<ShareTargets payload={payload} />);
    fireEvent.click(screen.getByRole('button', { name: 'WhatsApp' }));

    expect(navigations).toHaveLength(1);
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    expect(screen.queryByText(/Could not copy/)).toBeNull();
  });

  it('copies the canonical link and says so on the button itself', async () => {
    render(<ShareTargets payload={payload} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));

    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(payload.url),
    );

    // The feedback lands on the tile that was pressed, which is where the
    // person is already looking — not on a separate line below the row.
    await screen.findByRole('button', { name: 'Copied!' });
    expect(screen.queryByRole('button', { name: 'Copy link' })).toBeNull();
  });

  it('leaves every other destination untouched while one reports back', async () => {
    render(<ShareTargets payload={payload} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));

    await screen.findByRole('button', { name: 'Copied!' });
    for (const name of ['WhatsApp', 'X', 'LinkedIn', 'Reddit', 'Instagram']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
  });

  it('never claims a copy that did not happen', async () => {
    // A dialog that says "Link copied" over an empty clipboard sends somebody
    // away with nothing to paste and no idea why.
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('denied')) });
    document.execCommand = vi.fn().mockReturnValue(false);

    render(<ShareTargets payload={payload} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));

    await screen.findByRole('button', { name: 'Failed' });
    expect(screen.queryByRole('button', { name: 'Copied!' })).toBeNull();
    // And the reason reaches a screen reader, where there is room for it.
    await screen.findByText('Could not copy the link');
  });

  it('falls back to copying when the navigation cannot happen at all', async () => {
    render(<ShareTargets payload={payload} />);

    // Only the anchor fails. Breaking `createElement` outright would break
    // React's own rendering and prove nothing about this component.
    const realCreate = document.createElement.getMockImplementation();
    document.createElement.mockImplementation((tag) => {
      if (tag === 'a') throw new Error('detached');
      return realCreate(tag);
    });
    fireEvent.click(screen.getByRole('button', { name: 'X' }));

    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(payload.url),
    );
    await screen.findByText('Link copied instead');
  });

  describe('Instagram', () => {
    /**
     * Instagram Stories renders no link preview — see shareTargets.js. A URL
     * handed to Instagram only ever opens a Direct message, which is the exact
     * symptom this path exists to fix: no "Add to story", no "Add to post".
     * Sending the rendered card as an IMAGE FILE is what makes those appear,
     * because Instagram's share target advertises them for `image/*`.
     */
    const withFileSharing = () => {
      const card = new File([new Blob(['jpeg'])], 'meetifyy-post.jpg', {
        type: 'image/jpeg',
      });
      navigator.share = vi.fn().mockResolvedValue(undefined);
      navigator.canShare = vi.fn().mockReturnValue(true);
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        blob: async () => new Blob(['jpeg'], { type: 'image/jpeg' }),
      });
      return card;
    };

    const cardPayload = {
      ...payload,
      cardImageUrl: 'https://meetifyy.app/api/share/post/abc/image.jpg',
      cardFileName: 'meetifyy-post.jpg',
    };

    it('sends the card as a FILE, which is what unlocks Story and Post', async () => {
      withFileSharing();
      render(<ShareTargets payload={cardPayload} />);

      // The card is fetched while the dialog is merely open, so the tap itself
      // still holds the user gesture `navigator.share` requires.
      await waitFor(() =>
        expect(global.fetch).toHaveBeenCalledWith(
          cardPayload.cardImageUrl,
          expect.objectContaining({ credentials: 'omit' }),
        ),
      );

      fireEvent.click(screen.getByRole('button', { name: 'Instagram' }));

      await waitFor(() => expect(navigator.share).toHaveBeenCalled());
      const shared = navigator.share.mock.calls[0][0];
      expect(shared.files).toHaveLength(1);
      expect(shared.files[0].type).toBe('image/jpeg');
      // Files ONLY. Instagram given an image plus a URL can fall back to
      // treating the whole payload as a message, which is the case being fixed.
      expect(shared.url).toBeUndefined();
      expect(shared.text).toBeUndefined();
    });

    it('copies the link too, because a story needs a link sticker', async () => {
      withFileSharing();
      render(<ShareTargets payload={cardPayload} />);
      await waitFor(() => expect(global.fetch).toHaveBeenCalled());

      fireEvent.click(screen.getByRole('button', { name: 'Instagram' }));

      // Written BEFORE the sheet opens: the share sheet takes focus, and the
      // Clipboard API refuses to write from an unfocused document.
      await waitFor(() =>
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(payload.url),
      );
      await screen.findByText(/link sticker/i);
    });

    it('falls back to the link when the card cannot be fetched', async () => {
      navigator.share = vi.fn().mockResolvedValue(undefined);
      navigator.canShare = vi.fn().mockReturnValue(true);
      global.fetch = vi.fn().mockResolvedValue({ ok: false });

      render(<ShareTargets payload={cardPayload} />);
      await waitFor(() => expect(global.fetch).toHaveBeenCalled());

      fireEvent.click(screen.getByRole('button', { name: 'Instagram' }));

      // No files — the old URL path, which at least opens Instagram.
      await waitFor(() => expect(navigator.share).toHaveBeenCalled());
      expect(navigator.share.mock.calls[0][0].files).toBeUndefined();
      expect(navigator.share.mock.calls[0][0].url).toBe(payload.url);
    });

    it('does not download a card on a device that cannot share files', async () => {
      // Desktop. Fetching an image nothing can use is a wasted request on every
      // dialog open.
      global.fetch = vi.fn();
      render(<ShareTargets payload={cardPayload} />);
      await new Promise((r) => setTimeout(r, 20));
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('copies with an instruction, because there is no web share endpoint', async () => {
      render(<ShareTargets payload={payload} />);
      fireEvent.click(screen.getByRole('button', { name: 'Instagram' }));

      await waitFor(() =>
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(payload.url),
      );
      await screen.findByText(/Paste it into your Instagram/);
      // And never opens a URL, because every "Instagram share URL" is a login
      // wall with a redirect on the other side.
      expect(navigations).toHaveLength(0);
    });

    it('hands off to the OS share sheet where there is one', async () => {
      // On a phone this is the whole answer: the sheet lists every installed
      // app, Instagram among them, and the OS does the handoff properly. No
      // copy, no instruction to paste.
      navigator.share = vi.fn().mockResolvedValue(undefined);
      navigator.canShare = vi.fn().mockReturnValue(true);

      render(<ShareTargets payload={payload} />);
      fireEvent.click(screen.getByRole('button', { name: 'Instagram' }));

      await waitFor(() => expect(navigator.share).toHaveBeenCalledWith(payload));
      expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    });

    it('describes what the button will actually do on this device', () => {
      const { unmount } = render(<ShareTargets payload={payload} />);
      expect(screen.getByRole('button', { name: 'Instagram' }).title).toMatch(
        /cannot be sent a link/i,
      );
      unmount();

      // File sharing available: the card goes over as an image, so Story is on
      // the table and the hint says so.
      navigator.share = vi.fn();
      navigator.canShare = vi.fn().mockReturnValue(true);
      render(<ShareTargets payload={payload} />);
      expect(screen.getByRole('button', { name: 'Instagram' }).title).toMatch(
        /story/i,
      );
    });
  });

  describe('the native share sheet', () => {
    it('is offered only where the browser has one', () => {
      const { unmount } = render(<ShareTargets payload={payload} />);
      expect(screen.queryByRole('button', { name: /Share via/ })).toBeNull();
      unmount();

      navigator.share = vi.fn().mockResolvedValue(undefined);
      navigator.canShare = vi.fn().mockReturnValue(true);
      render(<ShareTargets payload={payload} />);
      expect(screen.getByRole('button', { name: /Share via/ })).toBeTruthy();
    });

    it('stays quiet when the user closes the sheet', async () => {
      const abort = new Error('cancelled');
      abort.name = 'AbortError';
      navigator.share = vi.fn().mockRejectedValue(abort);
      navigator.canShare = vi.fn().mockReturnValue(true);
      const onShared = vi.fn();

      render(<ShareTargets payload={payload} onShared={onShared} />);
      fireEvent.click(screen.getByRole('button', { name: /Share via/ }));

      await waitFor(() => expect(navigator.share).toHaveBeenCalled());
      expect(onShared).not.toHaveBeenCalled();
      expect(screen.queryByText(/Could not/)).toBeNull();
    });
  });

  it('refuses gracefully when there is no link to share', async () => {
    render(<ShareTargets payload={{ url: '', title: 'x', text: 'y' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'WhatsApp' }));

    await screen.findByText('This link is not available');
    expect(navigations).toHaveLength(0);
  });

  it('keeps a live region in the tree so its updates are announced', () => {
    // Rendering the region only when there is a message means it is created at
    // the same moment its text changes, and a screen reader that has not yet
    // observed the node announces nothing.
    const { container } = render(<ShareTargets payload={payload} />);
    const region = container.querySelector('[role="status"]');
    expect(region).toBeTruthy();
    expect(region.getAttribute('aria-live')).toBe('polite');
    // Empty, and taking no space, until something happens.
    expect(region.textContent).toBe('');
  });

  it('gives the screen reader the sentence that does not fit on a tile', async () => {
    render(<ShareTargets payload={payload} />);
    fireEvent.click(screen.getByRole('button', { name: 'Instagram' }));

    // The tile says "Copied!"; the region says what to do with it.
    await screen.findByRole('button', { name: 'Copied!' });
    await screen.findByText(/Paste it into your Instagram/);
  });
});
