/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  captureTextFocus,
  holdTextFocus,
  holdTextFocusOutsideInputs,
  restoreTextFocus,
  shouldAutoFocusSearch,
} from '../textFocus';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('holdTextFocus', () => {
  function Form() {
    return (
      <div>
        <input aria-label="bio" />
        <button type="button" aria-label="trigger" onPointerDown={holdTextFocus} onMouseDown={holdTextFocus} />
        <div role="listbox" onPointerDown={holdTextFocusOutsideInputs}>
          <input aria-label="menu search" />
          <button type="button" aria-label="option" />
        </div>
      </div>
    );
  }

  it('declines the focus move while a text field has focus', () => {
    render(<Form />);
    screen.getByLabelText('bio').focus();
    // fireEvent returns false when preventDefault was called.
    expect(fireEvent.pointerDown(screen.getByLabelText('trigger'))).toBe(false);
    expect(fireEvent.mouseDown(screen.getByLabelText('trigger'))).toBe(false);
  });

  it('leaves the press alone when nothing is being typed in', () => {
    render(<Form />);
    expect(fireEvent.pointerDown(screen.getByLabelText('trigger'))).toBe(true);
  });

  it('keeps the menu options from taking focus but not the menu search box', () => {
    render(<Form />);
    screen.getByLabelText('bio').focus();
    expect(fireEvent.pointerDown(screen.getByLabelText('option'))).toBe(false);
    expect(fireEvent.pointerDown(screen.getByLabelText('menu search'))).toBe(true);
  });
});

describe('captureTextFocus / restoreTextFocus', () => {
  it('returns the focused text field, and null for anything else', () => {
    render(<><input aria-label="a" /><button type="button">b</button></>);
    expect(captureTextFocus()).toBeNull();
    screen.getByLabelText('a').focus();
    expect(captureTextFocus()).toBe(screen.getByLabelText('a'));
    screen.getByRole('button').focus();
    expect(captureTextFocus()).toBeNull();
  });

  it('gives focus back only when it fell to the page', () => {
    render(<><input aria-label="a" /><input aria-label="b" /></>);
    const a = screen.getByLabelText('a');
    const b = screen.getByLabelText('b');
    a.focus();
    a.blur();
    restoreTextFocus(a);
    expect(document.activeElement).toBe(a);

    // Focus went to another field on purpose: not taken back.
    b.focus();
    restoreTextFocus(a);
    expect(document.activeElement).toBe(b);
  });

  it('ignores a field that has left the page', () => {
    const { unmount } = render(<input aria-label="a" />);
    const a = screen.getByLabelText('a');
    unmount();
    expect(() => restoreTextFocus(a)).not.toThrow();
    expect(() => restoreTextFocus(null)).not.toThrow();
  });
});

describe('shouldAutoFocusSearch', () => {
  const pointer = (coarse) =>
    vi.stubGlobal('matchMedia', (q) => ({ matches: coarse && q.includes('coarse'), media: q, addEventListener() {}, removeEventListener() {} }));

  it('waits to be tapped on a touch device with no keyboard up', () => {
    pointer(true);
    expect(shouldAutoFocusSearch()).toBe(false);
  });

  it('takes focus at once with a mouse and keyboard', () => {
    pointer(false);
    expect(shouldAutoFocusSearch()).toBe(true);
  });

  it('takes focus on touch when the keyboard is already up', () => {
    pointer(true);
    render(<input aria-label="a" />);
    screen.getByLabelText('a').focus();
    expect(shouldAutoFocusSearch()).toBe(true);
  });
});

describe('dismissKeyboardThen', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-keyboard-open');
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('runs at once when no keyboard is up', async () => {
    const { dismissKeyboardThen } = await import('../textFocus');
    const run = vi.fn();
    dismissKeyboardThen(run);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('blurs the field and waits for the keyboard to leave', async () => {
    const { dismissKeyboardThen } = await import('../textFocus');
    vi.stubGlobal('requestAnimationFrame', (cb) => { cb(); return 1; });
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    document.documentElement.setAttribute('data-keyboard-open', '');
    const run = vi.fn();
    dismissKeyboardThen(run);
    expect(document.activeElement).not.toBe(input);
    expect(run).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('meetifyy:keyboard-hidden'));
    expect(run).toHaveBeenCalledTimes(1);
    input.remove();
    vi.unstubAllGlobals();
  });

  it('can be cancelled', async () => {
    const { dismissKeyboardThen } = await import('../textFocus');
    vi.useFakeTimers();
    document.documentElement.setAttribute('data-keyboard-open', '');
    const run = vi.fn();
    const cancel = dismissKeyboardThen(run);
    cancel();
    vi.advanceTimersByTime(1000);
    expect(run).not.toHaveBeenCalled();
  });
});
