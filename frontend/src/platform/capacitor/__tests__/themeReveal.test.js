/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const plugin = {
  begin: vi.fn(),
  reveal: vi.fn(),
  reverse: vi.fn(),
  finish: vi.fn(),
};

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => 'android', isPluginAvailable: () => true },
  registerPlugin: () => plugin,
}));

const { createNativeThemeRevealDriver } = await import('../themeReveal');

const root = document.documentElement;
const origin = { x: 40, y: 700 };
let applied;
const apply = (theme) => { applied.push(theme); root.setAttribute('data-theme', theme); };
const fallback = { switchTo: vi.fn() };

/** The reveal promise, resolved by the test to say where the circle ended. */
let endReveal;

beforeEach(() => {
  applied = [];
  root.setAttribute('data-theme', 'light');
  vi.stubGlobal('requestAnimationFrame', (cb) => { setTimeout(cb, 0); return 1; });
  window.matchMedia = vi.fn(() => ({ matches: false }));
  plugin.begin.mockReset().mockResolvedValue({});
  plugin.finish.mockReset().mockResolvedValue({});
  plugin.reverse.mockReset().mockResolvedValue({});
  plugin.reveal.mockReset().mockImplementation(() => new Promise((r) => { endReveal = r; }));
  fallback.switchTo.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  root.removeAttribute('data-theme');
  root.className = '';
});

/**
 * Waits on the condition itself rather than on a fixed delay: the driver's
 * steps are chained promises and animation frames, and a fixed wait was too
 * short when the suite ran under load.
 */
const until = (assertion) => vi.waitFor(assertion, { timeout: 2000, interval: 2 });
const revealStarted = (n = 1) => until(() => expect(plugin.reveal).toHaveBeenCalledTimes(n));

describe('a switch', () => {
  it('captures first, applies the theme under the picture, then reveals the same circle as the web', async () => {
    const driver = createNativeThemeRevealDriver({ fallback });
    driver.switchTo('dark', { origin, apply });
    expect(plugin.begin).toHaveBeenCalledWith({ x: 40, y: 700 });
    expect(applied).toEqual([]);

    await revealStarted();
    expect(applied).toEqual(['dark']);
    const args = plugin.reveal.mock.calls[0][0];
    expect(args).toMatchObject({ x: 40, y: 700, duration: 800 });
    const expected = 1.6 * (Math.hypot(window.innerWidth, window.innerHeight) / Math.SQRT2);
    expect(args.radius).toBeCloseTo(expected);

    endReveal({ state: 'open' });
    await until(() => expect(root.classList.contains('theme-transitioning')).toBe(false));
    expect(plugin.finish).not.toHaveBeenCalled();
    expect(root.getAttribute('data-theme')).toBe('dark');
  });
});

describe('pressing again', () => {
  it('mid-reveal reverses the circle, and a closed circle puts the old theme back', async () => {
    const driver = createNativeThemeRevealDriver({ fallback });
    driver.switchTo('dark', { origin, apply });
    await revealStarted();

    driver.switchTo('light', { origin, apply });
    await until(() => expect(plugin.reverse).toHaveBeenCalledTimes(1));

    endReveal({ state: 'closed' });
    await until(() => expect(plugin.finish).toHaveBeenCalledTimes(1));
    expect(applied).toEqual(['dark', 'light']);
    expect(plugin.begin).toHaveBeenCalledTimes(1);
  });

  it('a third press turns it round again', async () => {
    const driver = createNativeThemeRevealDriver({ fallback });
    driver.switchTo('dark', { origin, apply });
    await revealStarted();
    driver.switchTo('light', { origin, apply });
    await until(() => expect(plugin.reverse).toHaveBeenCalledTimes(1));
    driver.switchTo('dark', { origin, apply });
    await until(() => expect(plugin.reverse).toHaveBeenCalledTimes(2));
    endReveal({ state: 'open' });
    await until(() => expect(root.classList.contains('theme-transitioning')).toBe(false));
    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(plugin.begin).toHaveBeenCalledTimes(1);
  });

  it('during the capture changes nothing on screen', async () => {
    const driver = createNativeThemeRevealDriver({ fallback });
    driver.switchTo('dark', { origin, apply });
    driver.switchTo('light', { origin, apply });
    await until(() => expect(plugin.finish).toHaveBeenCalledTimes(1));
    expect(applied).toEqual([]);
    expect(plugin.reveal).not.toHaveBeenCalled();
  });
});

describe('when the shell cannot capture', () => {
  it('hands this and every later switch to the View Transition driver', async () => {
    plugin.begin.mockRejectedValue(new Error('unsupported'));
    const driver = createNativeThemeRevealDriver({ fallback });
    driver.switchTo('dark', { origin, apply });
    await until(() => expect(fallback.switchTo).toHaveBeenCalledWith('dark', expect.objectContaining({ origin })));
    driver.switchTo('light', { origin, apply });
    expect(fallback.switchTo).toHaveBeenCalledTimes(2);
    expect(plugin.begin).toHaveBeenCalledTimes(1);
  });
});
