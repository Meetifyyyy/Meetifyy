import { describe, it, expect, beforeEach, vi } from 'vitest';
import { overlayManager } from '../../services/OverlayManager';
import { getMeaningfulPath, isAncestorPath } from '../useSmartNavigation';

describe('useSmartNavigation & OverlayManager', () => {
  beforeEach(() => {
    overlayManager.stack = [];
  });

  it('normalizes meaningful paths cleanly', () => {
    expect(getMeaningfulPath('/home')).toBe('/home');
    expect(getMeaningfulPath('/crew', '?tab=Saved')).toBe('/crew');
    expect(getMeaningfulPath('/search', '?q=test')).toBe('/search');
  });

  it('registers and dismisses open overlays in LIFO order', () => {
    const closeModal1 = vi.fn();
    const closeModal2 = vi.fn();

    overlayManager.open('modal-1', closeModal1, { pushHistoryState: false });
    overlayManager.open('modal-2', closeModal2, { pushHistoryState: false });

    expect(overlayManager.hasOpenOverlays()).toBe(true);
    expect(overlayManager.stack.length).toBe(2);

    overlayManager.closeTop();
    expect(overlayManager.stack.length).toBe(1);

    overlayManager.closeTop();
    expect(overlayManager.hasOpenOverlays()).toBe(false);
  });

  it('handles popstate event by closing top overlay without route navigation', () => {
    const closeModal = vi.fn();
    overlayManager.open('test-modal', closeModal, { pushHistoryState: false });

    overlayManager.handlePopstate(new Event('popstate'));

    expect(closeModal).toHaveBeenCalledTimes(1);
    expect(overlayManager.hasOpenOverlays()).toBe(false);
  });
});

describe('OverlayManager history integrity', () => {
  let navigator;
  let historyState;

  beforeEach(() => {
    overlayManager.stack = [];
    overlayManager.pendingSelfPops = 0;
    // React Router stamps `state` under `.usr` on the entry it pushes;
    // OverlayManager reads it back to prove the top entry is its own. The mock
    // has to do the same or nothing is ever poppable.
    historyState = null;
    navigator = vi.fn((to, opts) => {
      if (typeof to === 'number') return;
      historyState = { usr: opts?.state, key: 'k', idx: 0 };
    });
    overlayManager.navigator = navigator;
    overlayManager.readHistoryState = () => historyState;
  });

  it('pushes one history entry per overlay through the router, not raw pushState', () => {
    overlayManager.open('sheet', () => {});
    expect(navigator).toHaveBeenCalledTimes(1);
    const [url, options] = navigator.mock.calls[0];
    expect(typeof url).toBe('string');
    expect(options.state.__overlayId).toBe('sheet');
  });

  it('does not cascade: closing via the X button consumes its own popstate', () => {
    const closeA = vi.fn();
    const closeB = vi.fn();
    overlayManager.open('a', closeA);
    overlayManager.open('b', closeB);

    // User taps B's close button -> B closes and we go back one entry.
    overlayManager.close('b');
    expect(closeB).toHaveBeenCalledTimes(1);
    expect(closeA).not.toHaveBeenCalled();

    // The popstate our own navigate(-1) caused must not also close A.
    overlayManager.handlePopstate();
    expect(closeA).not.toHaveBeenCalled();
    expect(overlayManager.stack.length).toBe(1);
  });

  it('closes every overlay when a pop leaves the page they belong to', () => {
    const closeA = vi.fn();
    const closeB = vi.fn();
    overlayManager.open('a', closeA);
    overlayManager.open('b', closeB);
    // Simulate the entries having been opened on a different URL than we
    // landed on, i.e. the pop changed route rather than closing an overlay.
    overlayManager.stack.forEach((entry) => { entry.url = '/somewhere-else'; });

    overlayManager.handlePopstate();

    expect(closeA).toHaveBeenCalledTimes(1);
    expect(closeB).toHaveBeenCalledTimes(1);
    expect(overlayManager.hasOpenOverlays()).toBe(false);
  });

  it('closing a buried overlay tears down the ones stacked above it', () => {
    const closeA = vi.fn();
    const closeB = vi.fn();
    overlayManager.open('a', closeA);
    overlayManager.open('b', closeB);

    overlayManager.close('a');

    expect(closeA).toHaveBeenCalledTimes(1);
    expect(closeB).toHaveBeenCalledTimes(1);
    expect(overlayManager.hasOpenOverlays()).toBe(false);
    // Two entries were pushed, so exactly two are popped, in one go(-2).
    expect(navigator).toHaveBeenLastCalledWith(-2);
  });

  describe('isAncestorPath (up-navigation detection)', () => {
    it('treats a section root as an ancestor of a page inside it', () => {
      // tapping "Messages" while a chat is open is a return to the tab root:
      // pushing there stranded the chat one entry behind the list, so a later
      // Back re-opened the chat the user had just closed
      expect(isAncestorPath('/messages', '/messages/campus-walk/act_1')).toBe(true);
      expect(isAncestorPath('/campus', '/campus/communities')).toBe(true);
      expect(isAncestorPath('/crew', '/crew/abc-123')).toBe(true);
    });

    it('does not treat the same page as its own ancestor', () => {
      expect(isAncestorPath('/messages', '/messages')).toBe(false);
    });

    it('matches on a path boundary, not a bare prefix', () => {
      expect(isAncestorPath('/messages', '/messagesX')).toBe(false);
      expect(isAncestorPath('/crew', '/crewfinder/1')).toBe(false);
    });

    it('is false for sibling and unrelated sections', () => {
      expect(isAncestorPath('/home', '/messages/jaadu')).toBe(false);
      expect(isAncestorPath('/notifications', '/campus')).toBe(false);
    });

    it('never treats root as an ancestor, and tolerates missing input', () => {
      expect(isAncestorPath('/', '/messages')).toBe(false);
      expect(isAncestorPath(undefined, '/messages')).toBe(false);
      expect(isAncestorPath('/messages', undefined)).toBe(false);
    });
  });

});

describe('OverlayManager multi-step flows', () => {
  let navigator;
  let historyState;

  beforeEach(() => {
    overlayManager.stack = [];
    overlayManager.pendingSelfPops = 0;
    // React Router stamps `state` under `.usr` on the entry it pushes;
    // OverlayManager reads it back to prove the top entry is its own. The mock
    // has to do the same or nothing is ever poppable.
    historyState = null;
    navigator = vi.fn((to, opts) => {
      if (typeof to === 'number') return;
      historyState = { usr: opts?.state, key: 'k', idx: 0 };
    });
    overlayManager.navigator = navigator;
    overlayManager.readHistoryState = () => historyState;
  });

  it('keeps a stepping overlay registered and re-arms it for the next Back', () => {
    // A wizard reports "I stepped back, I am still open" by returning true.
    // If the manager dropped it from the stack anyway, the SECOND Back press
    // would find no overlay and navigate the page — losing the flow from
    // step 2 instead of stepping to step 1.
    let step = 3;
    const handler = vi.fn(() => {
      if (step <= 1) return false;
      step -= 1;
      return true;
    });

    overlayManager.open('wizard', handler);
    navigator.mockClear();

    overlayManager.handlePopstate();
    expect(step).toBe(2);
    expect(overlayManager.stack.length).toBe(1);
    // Re-armed: a fresh entry was pushed for the next press.
    expect(navigator).toHaveBeenCalledTimes(1);

    overlayManager.handlePopstate();
    expect(step).toBe(1);
    expect(overlayManager.stack.length).toBe(1);

    // Step one has nowhere to go, so this press closes for real.
    overlayManager.handlePopstate();
    expect(overlayManager.hasOpenOverlays()).toBe(false);
  });

  it('tells Back apart from a programmatic close', () => {
    // The X button on a wizard means "close the whole thing". Stepping it
    // back one page instead would make the close button refuse to close.
    const handler = vi.fn(() => true);
    overlayManager.open('wizard', handler);

    overlayManager.handlePopstate();
    expect(handler).toHaveBeenCalledWith(true);

    handler.mockClear();
    overlayManager.close('wizard');
    expect(handler).toHaveBeenCalledWith(false);
    expect(overlayManager.hasOpenOverlays()).toBe(false);
  });

  it('treats a throwing handler as closed rather than trapping every future Back', () => {
    const handler = vi.fn(() => { throw new Error('boom'); });
    overlayManager.open('broken', handler);

    overlayManager.handlePopstate();
    expect(overlayManager.hasOpenOverlays()).toBe(false);
  });
});

describe('OverlayManager history rebalance', () => {
  let navigator;
  let historyState;

  beforeEach(() => {
    overlayManager.stack = [];
    overlayManager.pendingSelfPops = 0;
    // React Router stamps `state` under `.usr` on the entry it pushes;
    // OverlayManager reads it back to prove the top entry is its own. The mock
    // has to do the same or nothing is ever poppable.
    historyState = null;
    navigator = vi.fn((to, opts) => {
      if (typeof to === 'number') return;
      historyState = { usr: opts?.state, key: 'k', idx: 0 };
    });
    overlayManager.navigator = navigator;
    overlayManager.readHistoryState = () => historyState;
  });

  it('gives back the entry it pushed when nothing else has navigated', () => {
    overlayManager.open('menu', () => {});
    navigator.mockClear();

    overlayManager.close('menu');
    expect(navigator).toHaveBeenCalledWith(-1);
  });

  it('does NOT pop when a navigation has happened since the overlay opened', () => {
    // A dropdown item that both closes the menu and opens a panel navigates in
    // the event handler, then the menu tears down in the effect cleanup right
    // after. Popping there cancels the panel the user just asked for — which
    // is how "open chat details" became un-openable from the header menu.
    overlayManager.open('menu', () => {});
    navigator.mockClear();

    const realUrl = overlayManager.currentUrl;
    overlayManager.currentUrl = () => '/messages/abc?view=details';
    try {
      overlayManager.close('menu');
      expect(navigator).not.toHaveBeenCalled();
    } finally {
      overlayManager.currentUrl = realUrl;
    }

    // The overlay is still properly deregistered either way — a stale entry in
    // the stack would swallow every later Back press.
    expect(overlayManager.hasOpenOverlays()).toBe(false);
  });

  it('unregisters on dispose without cancelling a navigation in flight', () => {
    const dispose = overlayManager.open('sheet', () => {});
    navigator.mockClear();

    const realUrl = overlayManager.currentUrl;
    overlayManager.currentUrl = () => '/somewhere/else';
    try {
      dispose();
      expect(navigator).not.toHaveBeenCalled();
    } finally {
      overlayManager.currentUrl = realUrl;
    }
    expect(overlayManager.hasOpenOverlays()).toBe(false);
  });
});

describe('OverlayManager — only pops history it can prove is its own', () => {
  let navigator;
  let historyState;

  beforeEach(() => {
    overlayManager.stack = [];
    overlayManager.pendingSelfPops = 0;
    historyState = null;
    navigator = vi.fn((to, opts) => {
      if (typeof to === 'number') return;
      historyState = { usr: opts?.state, key: 'k', idx: 0 };
    });
    overlayManager.navigator = navigator;
    overlayManager.readHistoryState = () => historyState;
  });

  it('does not touch history when the top entry is not one of ours', () => {
    // Cropping a community avatar or a profile picture: the cropper pushes,
    // then unmounts mid-flow when the crop is accepted. If anything replaced
    // the history state in between, a blind go(-1) walks the user off the page
    // they were editing — which is exactly what was happening.
    overlayManager.open('cropper', () => {});
    navigator.mockClear();

    historyState = { usr: undefined, key: 'someone-elses', idx: 5 };
    overlayManager.close('cropper');

    expect(navigator).not.toHaveBeenCalled();
    expect(overlayManager.hasOpenOverlays()).toBe(false);
  });

  it('does not pop when no history state exists at all', () => {
    overlayManager.open('cropper', () => {});
    navigator.mockClear();

    historyState = null;
    overlayManager.close('cropper');
    expect(navigator).not.toHaveBeenCalled();
  });

  it('still pops the entry when it IS provably on top', () => {
    // The guard must not be so strict that it never gives entries back —
    // otherwise every overlay leaves a dead Back press behind it.
    overlayManager.open('cropper', () => {});
    navigator.mockClear();

    overlayManager.close('cropper');
    expect(navigator).toHaveBeenCalledWith(-1);
  });

  it('gives back both entries when two overlays are torn down together', () => {
    overlayManager.open('modal', () => {});
    overlayManager.open('cropper', () => {});
    navigator.mockClear();

    // Closing the lower one takes the one above it with it; the browser is
    // sitting on the top entry, which is among those being removed.
    overlayManager.close('modal');
    expect(navigator).toHaveBeenCalledWith(-2);
  });
});
