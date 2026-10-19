/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ensureFocusedVisible, scrollableAncestor } from '../keyboardFocus';

const rect = (top, bottom) => ({ top, bottom, left: 0, right: 100, width: 100, height: bottom - top, x: 0, y: top, toJSON() {} });

let field;
beforeEach(() => {
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 875 });
  window.matchMedia = vi.fn(() => ({ matches: false }));
  window.scrollBy = vi.fn();
  field = document.createElement('textarea');
  document.body.appendChild(field);
  field.focus();
});
afterEach(() => {
  document.body.innerHTML = '';
});

describe('ensureFocusedVisible', () => {
  it('does nothing when the field is already above the keyboard', () => {
    field.getBoundingClientRect = () => rect(100, 200);
    expect(ensureFocusedVisible({ inset: 330, duration: 285 })).toBe(0);
    expect(window.scrollBy).not.toHaveBeenCalled();
  });

  it('scrolls the window by exactly the overlap plus the margin, smoothly', () => {
    // Keyboard top at 875 - 330 = 545; field bottom 600 -> 55 + 12 margin.
    field.getBoundingClientRect = () => rect(560, 600);
    expect(ensureFocusedVisible({ inset: 330, duration: 285 })).toBe(67);
    expect(window.scrollBy).toHaveBeenCalledWith({ top: 67, behavior: 'smooth' });
  });

  it('is instant with no animation or with reduced motion', () => {
    field.getBoundingClientRect = () => rect(560, 600);
    ensureFocusedVisible({ inset: 330, duration: 0 });
    expect(window.scrollBy).toHaveBeenLastCalledWith({ top: 67, behavior: 'instant' });
    window.matchMedia = vi.fn(() => ({ matches: true }));
    ensureFocusedVisible({ inset: 330, duration: 285 });
    expect(window.scrollBy).toHaveBeenLastCalledWith({ top: 67, behavior: 'instant' });
  });

  it('scrolls the nearest scrollable ancestor instead of the window', () => {
    const pane = document.createElement('div');
    pane.style.overflowY = 'auto';
    Object.defineProperty(pane, 'scrollHeight', { value: 2000 });
    Object.defineProperty(pane, 'clientHeight', { value: 600 });
    pane.scrollBy = vi.fn();
    document.body.appendChild(pane);
    pane.appendChild(field);
    field.focus();
    field.getBoundingClientRect = () => rect(560, 600);
    expect(scrollableAncestor(field)).toBe(pane);
    ensureFocusedVisible({ inset: 330, duration: 285 });
    expect(pane.scrollBy).toHaveBeenCalledWith({ top: 67, behavior: 'smooth' });
    expect(window.scrollBy).not.toHaveBeenCalled();
  });

  it("never scrolls a tall field's top off screen", () => {
    field.getBoundingClientRect = () => rect(40, 800);
    expect(ensureFocusedVisible({ inset: 330, duration: 285 })).toBe(28);
  });

  it('never scrolls for a field in a docked composer that rises with the keyboard', () => {
    const dock = document.createElement('div');
    dock.setAttribute('data-keyboard-dock', '');
    document.body.appendChild(dock);
    dock.appendChild(field);
    field.focus();
    field.getBoundingClientRect = () => rect(800, 840);
    expect(ensureFocusedVisible({ inset: 330, duration: 285 })).toBe(0);
    expect(window.scrollBy).not.toHaveBeenCalled();
  });

  it('ignores a focused element that is not a text field', () => {
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.focus();
    button.getBoundingClientRect = () => rect(700, 760);
    expect(ensureFocusedVisible({ inset: 330, duration: 285 })).toBe(0);
  });
});

describe('ensureFocusedVisible with a primary action in the form', () => {
  /** An <input> and a submit button in one form; each with the rect given. */
  function formWith(fieldRect, buttonRect, { marked = true } = {}) {
    document.body.innerHTML = '';
    const form = document.createElement('form');
    const input = document.createElement('input');
    const button = document.createElement('button');
    button.type = 'submit';
    if (marked) button.setAttribute('data-keyboard-reveal', '');
    form.append(input, button);
    document.body.appendChild(form);
    input.getBoundingClientRect = () => fieldRect;
    button.getBoundingClientRect = () => buttonRect;
    input.focus();
  }

  it('shows the button too when the field and the button fit together', () => {
    // Keyboard top 875 - 330 = 545, limit 533. Field is clear (bottom 480) but
    // the button is not (bottom 600): scroll by the button's overlap.
    formWith(rect(430, 480), rect(520, 600));
    expect(ensureFocusedVisible({ inset: 330, duration: 285 })).toBe(67);
    expect(window.scrollBy).toHaveBeenCalledWith({ top: 67, behavior: 'smooth' });
  });

  it('falls back to the field alone when both cannot be shown', () => {
    // From the field's top (100) to the button's bottom (700) is 600px; only
    // 533 - 12 are available above the keyboard.
    formWith(rect(100, 150), rect(650, 700));
    expect(ensureFocusedVisible({ inset: 330, duration: 285 })).toBe(0);
    expect(window.scrollBy).not.toHaveBeenCalled();
  });

  it('ignores a button that is not marked as the primary action', () => {
    formWith(rect(430, 480), rect(520, 600), { marked: false });
    expect(ensureFocusedVisible({ inset: 330, duration: 285 })).toBe(0);
  });

  it('does not move for a button that is already above the keyboard', () => {
    formWith(rect(300, 340), rect(360, 420));
    expect(ensureFocusedVisible({ inset: 330, duration: 285 })).toBe(0);
  });
});

