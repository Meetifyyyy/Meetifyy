/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import CustomSelect from '../CustomSelect';

/**
 * In the Android app the keyboard overlays the page: `visualViewport.height`
 * stays at the full screen and only `--kb-inset` says where the keyboard
 * starts. A select opened under a field with the keyboard up must open ABOVE
 * its trigger, not into the keyboard, and follow the keyboard as it hides.
 */
describe('CustomSelect with an overlaying keyboard', () => {
  const root = document.documentElement;
  const options = [
    { value: 'a', label: 'Alpha' },
    { value: 'b', label: 'Beta' },
  ];
  let frames;

  beforeEach(() => {
    frames = [];
    vi.stubGlobal('innerHeight', 800);
    vi.stubGlobal('visualViewport', Object.assign(new EventTarget(), { height: 800, width: 400, offsetTop: 0 }));
    vi.stubGlobal('requestAnimationFrame', (cb) => { frames.push(cb); return frames.length; });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    // jsdom has no scrollIntoView; the select scrolls its highlighted option.
    HTMLElement.prototype.scrollIntoView = vi.fn();
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 420, bottom: 460, left: 20, right: 220, width: 200, height: 40, x: 20, y: 420, toJSON: () => ({}),
    });
  });

  afterEach(() => {
    cleanup();
    root.style.removeProperty('--kb-inset');
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete HTMLElement.prototype.scrollIntoView;
  });

  const open = () => {
    render(<CustomSelect options={options} value="" onChange={() => {}} aria-label="Pick" />);
    fireEvent.click(screen.getByRole('combobox', { name: /pick/i }));
    return screen.getByRole('listbox');
  };

  it('opens below the trigger with no keyboard', () => {
    const list = open();
    expect(list.style.top).toBe('464px');
    expect(list.style.bottom).toBe('auto');
  });

  it('opens above the trigger when the keyboard covers the space below it', () => {
    root.style.setProperty('--kb-inset', '320px');
    const list = open();
    expect(list.style.top).toBe('auto');
    // From the bottom of the layout viewport (800), not of the visible area.
    expect(list.style.bottom).toBe(`${800 - 420 + 4}px`);
  });

  it('moves back below once the keyboard starts to hide, instead of closing', () => {
    root.style.setProperty('--kb-inset', '320px');
    const list = open();
    expect(list.style.top).toBe('auto');

    root.style.setProperty('--kb-inset', '0px');
    act(() => {
      window.dispatchEvent(new CustomEvent('meetifyy:ime', { detail: { visible: false, height: 0, duration: 250 } }));
      frames.splice(0).forEach((cb) => cb());
    });
    expect(screen.getByRole('listbox').style.top).toBe('464px');
  });
});
