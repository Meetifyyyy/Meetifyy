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

  beforeEach(() => {
    overlayManager.stack = [];
    overlayManager.pendingSelfPops = 0;
    navigator = vi.fn();
    overlayManager.navigator = navigator;
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
