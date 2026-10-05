import { describe, expect, it, vi } from 'vitest';
import { overlayManager } from '@shared/services/OverlayManager';

describe('OverlayManager route change notifications', () => {
  it('tells every subscriber the new url, and stops after unsubscribe', () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = overlayManager.onRouteChange(a);
    const offB = overlayManager.onRouteChange(b);
    overlayManager.notifyRouteChange('/x?y=1');
    expect(a).toHaveBeenCalledWith('/x?y=1');
    expect(b).toHaveBeenCalledWith('/x?y=1');
    offA();
    overlayManager.notifyRouteChange('/z');
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
    offB();
  });

  it('keeps notifying the rest when one subscriber throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad = vi.fn(() => { throw new Error('boom'); });
    const good = vi.fn();
    const offBad = overlayManager.onRouteChange(bad);
    const offGood = overlayManager.onRouteChange(good);
    overlayManager.notifyRouteChange('/q');
    expect(good).toHaveBeenCalledWith('/q');
    offBad();
    offGood();
    vi.restoreAllMocks();
  });
});
