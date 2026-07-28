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
