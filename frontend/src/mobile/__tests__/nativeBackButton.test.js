import { describe, it, expect, vi } from 'vitest';

import { installNativeBackButton } from '../nativeBackButton';

/**
 * A stand-in for the Capacitor plugin, so these tests describe the DECISION
 * rather than the bridge. `press` is what the OS does.
 */
function fakeBackButton() {
  const listeners = new Set();
  return {
    exitApp: vi.fn(() => Promise.resolve()),
    onPress(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    press(canGoBack) {
      listeners.forEach((l) => l({ canGoBack }));
    },
    get listenerCount() {
      return listeners.size;
    },
  };
}

describe('installNativeBackButton', () => {
  it('goes back when the WebView has history', () => {
    const backButton = fakeBackButton();
    const goBack = vi.fn();
    const exit = vi.fn();

    installNativeBackButton(backButton, { goBack, exit });
    backButton.press(true);

    expect(goBack).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled();
  });

  /**
   * The regression this whole file exists for. Before the listener was
   * registered, Android's default finished the Activity, so a back press on a
   * sub-route killed the process instead of returning one screen. Exiting is
   * correct ONLY at the root.
   */
  it('exits the app only when there is nowhere to go back to', () => {
    const backButton = fakeBackButton();
    const goBack = vi.fn();
    const exit = vi.fn();

    installNativeBackButton(backButton, { goBack, exit });
    backButton.press(false);

    expect(exit).toHaveBeenCalledTimes(1);
    expect(goBack).not.toHaveBeenCalled();
  });

  it('one press is one decision — repeated presses do not compound', () => {
    const backButton = fakeBackButton();
    const goBack = vi.fn();

    installNativeBackButton(backButton, { goBack, exit: vi.fn() });
    backButton.press(true);
    backButton.press(true);
    backButton.press(true);

    expect(goBack).toHaveBeenCalledTimes(3);
  });

  it('unsubscribing stops the handler answering', () => {
    const backButton = fakeBackButton();
    const goBack = vi.fn();

    const off = installNativeBackButton(backButton, { goBack, exit: vi.fn() });
    expect(backButton.listenerCount).toBe(1);

    off();
    backButton.press(true);

    expect(backButton.listenerCount).toBe(0);
    expect(goBack).not.toHaveBeenCalled();
  });

  /**
   * Web has no hardware back, so `PlatformServices.backButton` is absent there.
   * Absence must be survivable rather than a crash at the composition root.
   */
  it('is a no-op on a platform that has no back button', () => {
    expect(() => installNativeBackButton(undefined)()).not.toThrow();
  });

  it('defaults to exiting through the plugin when no exit is injected', () => {
    const backButton = fakeBackButton();

    installNativeBackButton(backButton, { goBack: vi.fn() });
    backButton.press(false);

    expect(backButton.exitApp).toHaveBeenCalledTimes(1);
  });
});
