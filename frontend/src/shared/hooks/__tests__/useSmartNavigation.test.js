import { describe, it, expect, beforeEach, vi } from 'vitest';
import { overlayManager } from '../../services/OverlayManager';
import { getMeaningfulPath } from '../useSmartNavigation';

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
});
