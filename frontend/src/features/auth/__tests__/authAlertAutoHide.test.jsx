/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import AuthAlert from '../shared/ui/AuthAlert';

/**
 * The login notice closes by itself: its countdown bar's animation end is
 * the timer. A retry that fails with the same message must show it again,
 * which is what `nonce` is for.
 */
afterEach(cleanup);

const dock = () => document.querySelector('[class*="alertDock"]');
const isOpen = () => /alertDockOpen/.test(dock().className);

describe('AuthAlert auto-hide', () => {
  it('closes when the countdown ends, and reopens for the same message with a new nonce', () => {
    const { rerender } = render(
      <AuthAlert title="Couldn't log in" autoHideMs={4000} nonce={1}>Network down</AuthAlert>,
    );
    expect(isOpen()).toBe(true);
    expect(screen.getByText("Couldn't log in")).toBeTruthy();

    const bar = document.querySelector('[class*="alertCountdown"]');
    expect(bar.style.animationDuration).toBe('4000ms');
    // jsdom has no AnimationEvent, so React may be listening for the
    // prefixed name instead; send both, as a browser would send one.
    act(() => {
      bar.dispatchEvent(new Event('animationend', { bubbles: true }));
      bar.dispatchEvent(new Event('webkitAnimationEnd', { bubbles: true }));
    });
    expect(isOpen()).toBe(false);

    rerender(<AuthAlert title="Couldn't log in" autoHideMs={4000} nonce={2}>Network down</AuthAlert>);
    expect(isOpen()).toBe(true);
  });

  it('has no countdown unless asked for one', () => {
    render(<AuthAlert>Something</AuthAlert>);
    expect(document.querySelector('[class*="alertCountdown"]')).toBeNull();
  });
});
