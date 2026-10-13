/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installSystemBars } from '../installSystemBars';

const root = document.documentElement;
let frames;
let edges;
let uninstall;
let bars;

const flushFrames = () => { frames.splice(0).forEach((cb) => cb(0)); };
/** Let the MutationObserver deliver, then run the frame it scheduled. */
const settleDom = async () => { await Promise.resolve(); flushFrames(); };
// The strips' colours live in rules of their own (see installSystemBars).
const stripValue = (name) => {
  const sheet = document.querySelector('style[data-system-bars]')?.sheet;
  for (const rule of sheet?.cssRules || []) {
    const value = rule.style?.getPropertyValue(name);
    if (value) return value.trim();
  }
  return '';
};
const top = () => stripValue('--sys-top-bg');
const bottom = () => stripValue('--sys-bottom-bg');

beforeEach(() => {
  vi.useFakeTimers();
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (cb) => { frames.push(cb); return frames.length; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  edges = { top: '#111111', bottom: '#222222' };
  bars = { setIcons: vi.fn(), persistTheme: vi.fn(), setWindowColor: vi.fn() };
  uninstall = installSystemBars(bars, { readEdges: () => edges });
});

afterEach(() => {
  uninstall();
  for (const a of ['data-pull-active', 'data-bars-scroll-through', 'data-chrome-hidden', 'data-theme']) root.removeAttribute(a);
  root.removeAttribute('style');
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('pull-to-refresh', () => {
  it('holds the strip colours while a pull is on screen, then samples again', async () => {
    expect(top()).toBe('#111111');
    root.setAttribute('data-pull-active', '');
    edges = { top: '#ffffff', bottom: '#222222' }; // the white gap surface at the edge
    await settleDom();
    window.dispatchEvent(new Event('resize'));
    flushFrames();
    expect(top()).toBe('#111111');

    edges = { top: '#111111', bottom: '#222222' };
    root.removeAttribute('data-pull-active');
    await settleDom();
    expect(top()).toBe('#111111');
  });

  it('takes a real page change once the pull has gone', async () => {
    root.setAttribute('data-pull-active', '');
    await settleDom();
    root.removeAttribute('data-pull-active');
    edges = { top: '#333333', bottom: '#444444' };
    await settleDom();
    expect(top()).toBe('#333333');
    expect(bottom()).toBe('#444444');
  });
});

describe('scroll-through screen (Home)', () => {
  it('keeps the pre-hide colours through hide and the slide back, then samples', async () => {
    root.setAttribute('data-bars-scroll-through', '');
    await settleDom();
    root.setAttribute('data-chrome-hidden', 'true');
    edges = { top: '#abcdef', bottom: '#fedcba' }; // feed visible mid-slide
    await settleDom();
    expect(top()).toBe('#111111');
    expect(bottom()).toBe('#222222');

    root.removeAttribute('data-chrome-hidden');
    await settleDom();
    expect(top()).toBe('#111111'); // still sliding back: unchanged

    edges = { top: '#111111', bottom: '#222222' }; // header back at the edge
    vi.advanceTimersByTime(400);
    flushFrames();
    expect(top()).toBe('#111111');
  });

  it('gives the icons the theme while the bars are see-through', async () => {
    root.setAttribute('data-theme', 'dark');
    root.setAttribute('data-bars-scroll-through', '');
    await settleDom();
    root.setAttribute('data-chrome-hidden', 'true');
    await settleDom();
    expect(bars.setIcons).toHaveBeenLastCalledWith({ status: true, navigation: true });
  });

  it("keeps a screen's own icon hint when the chrome hides (Profile's cover header)", async () => {
    root.setAttribute('data-theme', 'light');
    root.setAttribute('data-bars-scroll-through', '');
    root.setAttribute('data-status-bar-icons', 'light');
    await settleDom();
    expect(bars.setIcons).toHaveBeenLastCalledWith(expect.objectContaining({ status: true }));
    root.setAttribute('data-chrome-hidden', 'true');
    await settleDom();
    // Not the light theme's dark icons: the cover header's light ones.
    expect(bars.setIcons).toHaveBeenLastCalledWith(expect.objectContaining({ status: true }));
    root.removeAttribute('data-status-bar-icons');
  });
});

describe('every other screen', () => {
  it('still samples when the chrome hides (unchanged behaviour)', async () => {
    root.setAttribute('data-chrome-hidden', 'true');
    edges = { top: '#abcdef', bottom: '#fedcba' };
    await settleDom();
    expect(top()).toBe('#abcdef');
    expect(bottom()).toBe('#fedcba');
  });
});

describe('text entry', () => {
  afterEach(() => {
    root.removeAttribute('data-text-entry');
    history.replaceState({}, '', '/');
  });

  it('holds the strips while typing on the same page', () => {
    root.setAttribute('data-text-entry', '');
    edges = { top: '#555555', bottom: '#666666' };
    window.dispatchEvent(new Event('resize'));
    flushFrames();
    expect(top()).toBe('#111111');
  });

  it('samples a new route even with the keyboard up (Home search -> /search)', () => {
    root.setAttribute('data-text-entry', '');
    history.pushState({}, '', '/search');
    edges = { top: '#ffffff', bottom: '#ffffff' };
    window.dispatchEvent(new Event('resize'));
    flushFrames();
    expect(top()).toBe('#ffffff');
  });
});

describe('transitions', () => {
  it('ignores transitions inside a keyboard dock or an opted-out element, samples others', () => {
    const before = top();
    const dock = document.createElement('div');
    dock.setAttribute('data-keyboard-dock', '');
    const composer = document.createElement('div');
    composer.setAttribute('data-bars-transition-ignore', '');
    const inner = document.createElement('span');
    composer.appendChild(inner);
    const other = document.createElement('div');
    document.body.append(dock, composer, other);

    edges = { top: '#121212', bottom: '#343434' };
    dock.dispatchEvent(new Event('transitionend', { bubbles: true }));
    inner.dispatchEvent(new Event('transitionend', { bubbles: true }));
    flushFrames();
    expect(top()).toBe(before);

    other.dispatchEvent(new Event('transitionend', { bubbles: true }));
    flushFrames();
    expect(top()).toBe('#121212');
    dock.remove(); composer.remove(); other.remove();
  });
});

describe('where the strip colours are written', () => {
  it('never on <html> itself, where they would restyle the whole page', () => {
    expect(top()).toBe('#111111');
    expect(bottom()).toBe('#222222');
    for (const name of ['--sys-top-bg', '--sys-bottom-bg', '--sys-window-bg']) {
      expect(root.style.getPropertyValue(name)).toBe('');
    }
  });

  it('removes its rules when uninstalled', () => {
    uninstall();
    expect(document.querySelector('style[data-system-bars]')).toBeNull();
    expect(root.hasAttribute('data-system-bars')).toBe(false);
    uninstall = () => {};
  });
});

describe('leaving a cover page for a scroll-through one', () => {
  afterEach(() => {
    root.removeAttribute('data-collapsing-header');
    history.replaceState({}, '', '/');
  });

  it("does not hold the cover page's see-through strip on the next route", async () => {
    history.replaceState({}, '', '/profile/someone');
    root.setAttribute('data-bars-scroll-through', '');
    root.setAttribute('data-collapsing-header', '');
    root.setAttribute('data-chrome-hidden', 'true');
    await settleDom();
    root.removeAttribute('data-chrome-hidden');
    await settleDom();
    vi.advanceTimersByTime(400);
    flushFrames();
    expect(top()).toBe('transparent');

    // Home: the chrome slides back in (inside the hold window) on a new route.
    edges = { top: '#dae8f9', bottom: '#222222' };
    history.replaceState({}, '', '/home');
    root.setAttribute('data-chrome-hidden', 'true');
    root.removeAttribute('data-collapsing-header');
    await settleDom();
    root.removeAttribute('data-chrome-hidden');
    await settleDom();
    expect(top()).toBe('#dae8f9');
  });

  it('samples once the cover request goes, even if the route changed before it', async () => {
    history.replaceState({}, '', '/profile/someone');
    root.setAttribute('data-bars-scroll-through', '');
    root.setAttribute('data-collapsing-header', '');
    await settleDom();
    expect(top()).toBe('transparent');

    // Home renders while Profile's request is still on <html>...
    edges = { top: '#dae8f9', bottom: '#222222' };
    history.replaceState({}, '', '/home');
    root.setAttribute('data-chrome-hidden', 'true');
    await settleDom();
    // ...then it goes, as the chrome slides back in (inside the hold window).
    root.removeAttribute('data-collapsing-header');
    root.removeAttribute('data-chrome-hidden');
    await settleDom();
    expect(top()).toBe('#dae8f9');
  });
});
