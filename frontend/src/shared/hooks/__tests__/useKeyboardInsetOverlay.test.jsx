/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

/**
 * The installed Android app's keyboard path: the keyboard overlays the page
 * and SystemUiPlugin reports it once per transition as `meetifyy:ime`. These
 * pin the contract every keyboard consumer codes against.
 */
vi.mock('@config', () => ({ IS_MOBILE_BUILD: true }));
const ensureFocusedVisible = vi.fn((_opts) => 0);
vi.mock('@shared/utils/keyboardFocus', () => ({
  ensureFocusedVisible: (opts) => ensureFocusedVisible(opts),
}));

// Before the import: KEYBOARD_OVERLAYS_PAGE is fixed when its module loads.
const uaGetter = vi.spyOn(window.navigator, 'userAgent', 'get');
uaGetter.mockReturnValue('Mozilla/5.0 (Linux; Android 15; wv) Chrome/140');
const { useKeyboardInset } = await import('../useKeyboardInset');

function Probe() {
  useKeyboardInset();
  return <textarea data-testid="field" />;
}

const root = document.documentElement;
const ime = (detail) => window.dispatchEvent(new CustomEvent('meetifyy:ime', { detail }));

beforeEach(() => {
  vi.useFakeTimers();
  uaGetter.mockReturnValue('Mozilla/5.0 (Linux; Android 15; wv) Chrome/140');
  window.matchMedia = vi.fn((q) => ({ matches: q === '(pointer: coarse)', media: q, addEventListener() {}, removeEventListener() {} }));
  root.removeAttribute('style');
  root.removeAttribute('data-text-entry');
  root.removeAttribute('data-keyboard-open');
  root.style.setProperty('--navigation-bar-inset', '42px');
  ensureFocusedVisible.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useKeyboardInset — Android overlay', () => {
  it('writes the inset, duration and open flag once per transition', () => {
    render(<Probe />);
    const writes = vi.spyOn(root.style, 'setProperty');
    ime({ visible: true, height: 288, duration: 285 });
    expect(root.style.getPropertyValue('--kb-inset')).toBe('288px');
    expect(root.style.getPropertyValue('--kb-duration')).toBe('285ms');
    expect(root.hasAttribute('data-keyboard-open')).toBe(true);
    expect(writes).toHaveBeenCalledTimes(2);

    // The same state again (a re-dispatch) writes nothing.
    writes.mockClear();
    ime({ visible: true, height: 288, duration: 285 });
    expect(writes).not.toHaveBeenCalled();
    writes.mockRestore();
  });

  it('starts the page transition as far into its curve as the keyboard already is', () => {
    render(<Probe />);
    vi.setSystemTime(10_000);
    // Delivered 20ms after the IME animation started, plus the frames the
    // transition takes to reach the screen.
    ime({ visible: true, height: 330, duration: 285, startedAt: 9_980 });
    expect(root.style.getPropertyValue('--kb-delay')).toBe('-60ms');
    // Hiding reaches the screen sooner.
    ime({ visible: false, height: 0, duration: 285, startedAt: 9_990 });
    expect(root.style.getPropertyValue('--kb-delay')).toBe('-40ms');
    // Never more than the whole animation.
    ime({ visible: true, height: 330, duration: 285, startedAt: 1_000 });
    expect(root.style.getPropertyValue('--kb-delay')).toBe('-285ms');
  });

  it('never writes --kb-layout-shift beyond zero and keeps --app-vh at the full height', () => {
    render(<Probe />);
    expect(root.style.getPropertyValue('--kb-layout-shift')).toBe('0px');
    const appVh = root.style.getPropertyValue('--app-vh');
    ime({ visible: true, height: 288, duration: 285 });
    expect(root.style.getPropertyValue('--kb-layout-shift')).toBe('0px');
    expect(root.style.getPropertyValue('--app-vh')).toBe(appVh);
  });

  it('asks for the focused field to be kept visible above the keyboard, a frame after the write', () => {
    render(<Probe />);
    ime({ visible: true, height: 330, duration: 285 });
    expect(ensureFocusedVisible).not.toHaveBeenCalled();
    vi.advanceTimersToNextFrame();
    expect(ensureFocusedVisible).toHaveBeenCalledWith({ inset: 330, duration: 285 });
    ime({ visible: false, height: 0, duration: 285 });
    vi.advanceTimersToNextFrame();
    expect(ensureFocusedVisible).toHaveBeenCalledTimes(1);
  });

  it('does not check the field when the keyboard hides before the next frame', () => {
    render(<Probe />);
    ime({ visible: true, height: 288, duration: 285 });
    ime({ visible: false, height: 0, duration: 285 });
    vi.advanceTimersToNextFrame();
    expect(ensureFocusedVisible).not.toHaveBeenCalled();
  });

  it('ends text entry once the keyboard has finished leaving', () => {
    const { getByTestId } = render(<Probe />);
    getByTestId('field').focus();
    expect(root.hasAttribute('data-text-entry')).toBe(true);
    ime({ visible: true, height: 288, duration: 285 });

    const hidden = vi.fn();
    const ended = vi.fn();
    window.addEventListener('meetifyy:keyboard-hidden', hidden);
    window.addEventListener('meetifyy:text-entry-end', ended);
    ime({ visible: false, height: 0, duration: 285 });
    // The inset goes at once, so docked UI moves with the keyboard...
    expect(root.style.getPropertyValue('--kb-inset')).toBe('0px');
    expect(root.hasAttribute('data-keyboard-open')).toBe(false);
    // ...and text entry ends when it is gone.
    expect(root.hasAttribute('data-text-entry')).toBe(true);
    vi.advanceTimersByTime(285);
    expect(root.hasAttribute('data-text-entry')).toBe(false);
    expect(hidden).toHaveBeenCalledTimes(1);
    expect(ended).toHaveBeenCalledTimes(1);
    window.removeEventListener('meetifyy:keyboard-hidden', hidden);
    window.removeEventListener('meetifyy:text-entry-end', ended);
  });

  it('keeps text entry when the keyboard comes back before it finished leaving', () => {
    const { getByTestId } = render(<Probe />);
    getByTestId('field').focus();
    ime({ visible: true, height: 288, duration: 285 });
    ime({ visible: false, height: 0, duration: 285 });
    vi.advanceTimersByTime(100);
    ime({ visible: true, height: 288, duration: 285 });
    vi.advanceTimersByTime(1000);
    expect(root.hasAttribute('data-text-entry')).toBe(true);
    expect(root.hasAttribute('data-keyboard-open')).toBe(true);
  });

  it('gives up text entry when no keyboard follows the focus', () => {
    const { getByTestId } = render(<Probe />);
    getByTestId('field').focus();
    vi.advanceTimersByTime(800);
    expect(root.hasAttribute('data-text-entry')).toBe(false);
  });

  it('ignores resize events for the keyboard (there are none to measure)', () => {
    render(<Probe />);
    window.dispatchEvent(new Event('resize'));
    expect(root.style.getPropertyValue('--kb-inset')).toBe('');
    expect(root.hasAttribute('data-keyboard-open')).toBe(false);
  });
});
