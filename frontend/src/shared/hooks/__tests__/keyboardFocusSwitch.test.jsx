/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

vi.mock('@config', () => ({ IS_MOBILE_BUILD: true }));
vi.mock('@shared/utils/keyboardOverlay', () => ({ KEYBOARD_OVERLAYS_PAGE: true }));
const reveal = vi.hoisted(() => vi.fn());
vi.mock('@shared/utils/keyboardFocus', () => ({ ensureFocusedVisible: reveal }));

import { useKeyboardInset } from '../useKeyboardInset';

function Form() {
  useKeyboardInset();
  return (
    <>
      <input aria-label="First" />
      <input aria-label="Last" />
    </>
  );
}

/**
 * Moving from one field to the next with the keyboard already up raises no new
 * keyboard transition, so nothing but the focus change can bring the next field
 * above the keyboard.
 */
describe('moving between fields with the keyboard up (installed Android app)', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    reveal.mockClear();
  });

  it('reveals the next field without requiring a second keyboard transition', () => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    vi.stubGlobal('requestAnimationFrame', (callback) => setTimeout(callback, 16));
    vi.stubGlobal('cancelAnimationFrame', (id) => clearTimeout(id));
    render(<Form />);

    act(() => {
      screen.getByLabelText('First').focus();
      window.dispatchEvent(new CustomEvent('meetifyy:ime', { detail: { visible: true, height: 300, duration: 250 } }));
      vi.advanceTimersByTime(20);
    });
    reveal.mockClear();

    act(() => {
      screen.getByLabelText('Last').focus();
      vi.advanceTimersByTime(20);
    });
    expect(reveal).toHaveBeenCalledWith({ inset: 300, duration: 250 });
  });
});
