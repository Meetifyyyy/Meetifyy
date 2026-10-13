/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THEME_REVEAL_MS, createViewTransitionDriver, themeRevealRadius } from '../themeTransition';

const root = document.documentElement;

/** A controllable stand-in for one View Transition and its reveal animation. */
function installFakeViewTransitions() {
  const transitions = [];
  document.startViewTransition = vi.fn((update) => {
    let resolveReady;
    let resolveFinished;
    const t = {
      ready: new Promise((r) => { resolveReady = r; }),
      finished: new Promise((r) => { resolveFinished = r; }),
      skipped: false,
      skipTransition: vi.fn(() => { t.skipped = true; resolveFinished(); }),
      start: async () => { await update(); resolveReady(); await Promise.resolve(); },
      end: () => resolveFinished(),
    };
    transitions.push(t);
    return t;
  });
  const animations = [];
  root.animate = vi.fn((keyframes, options) => {
    let resolveFinished;
    const a = {
      keyframes,
      options,
      playState: 'running',
      playbackRate: 1,
      finished: new Promise((r) => { resolveFinished = r; }),
      reverse: vi.fn(() => { a.playbackRate *= -1; }),
      cancel: vi.fn(() => { a.playState = 'idle'; }),
      complete: () => { a.playState = 'finished'; resolveFinished(); },
    };
    animations.push(a);
    return a;
  });
  return { transitions, animations };
}

const flush = async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); };

let fake;
let applied;
const apply = (theme) => { applied.push(theme); root.setAttribute('data-theme', theme); };
const origin = { x: 100, y: 200 };

beforeEach(() => {
  vi.useFakeTimers();
  fake = installFakeViewTransitions();
  applied = [];
  root.setAttribute('data-theme', 'light');
  window.matchMedia = vi.fn(() => ({ matches: false }));
});

afterEach(() => {
  delete document.startViewTransition;
  delete root.animate;
  root.className = '';
  root.removeAttribute('data-theme');
  vi.useRealTimers();
});

describe('the reveal', () => {
  it('is a linear 800ms circle from the origin to 160%, and writes nothing to <html> first', async () => {
    const driver = createViewTransitionDriver();
    driver.switchTo('dark', { origin, apply });

    // Nothing touched before the transition's own callback runs.
    expect(root.classList.contains('theme-transitioning')).toBe(false);
    expect(root.style.getPropertyValue('--vt-origin-x')).toBe('');

    await fake.transitions[0].start();
    expect(applied).toEqual(['dark']);
    expect(root.classList.contains('theme-transitioning')).toBe(true);

    const [anim] = fake.animations;
    expect(anim.options).toMatchObject({
      duration: THEME_REVEAL_MS,
      easing: 'linear',
      fill: 'forwards',
      pseudoElement: '::view-transition-new(root)',
    });
    expect(anim.keyframes.clipPath[0]).toMatch(/^circle\(0px at /);
    expect(anim.keyframes.clipPath[1]).toMatch(/^circle\(160% at /);
  });

  it('takes the transitioning class off once idle after the switch, not in the next frame', async () => {
    const driver = createViewTransitionDriver();
    driver.switchTo('dark', { origin, apply });
    await fake.transitions[0].start();
    fake.animations[0].complete();
    fake.transitions[0].end();
    await flush();
    expect(fake.animations[0].cancel).toHaveBeenCalled();
    expect(root.classList.contains('theme-transitioning')).toBe(true);
    vi.runAllTimers();
    expect(root.classList.contains('theme-transitioning')).toBe(false);
  });
});

describe('pressing again mid-reveal', () => {
  it('reverses the circle and, once it has closed, puts the old theme back with no new capture', async () => {
    const driver = createViewTransitionDriver();
    driver.switchTo('dark', { origin, apply });
    await fake.transitions[0].start();
    const [anim] = fake.animations;

    driver.switchTo('light', { origin, apply });
    expect(anim.reverse).toHaveBeenCalledTimes(1);
    expect(document.startViewTransition).toHaveBeenCalledTimes(1);

    anim.complete();
    await flush();
    expect(applied).toEqual(['dark', 'light']);
    expect(fake.transitions[0].skipTransition).toHaveBeenCalled();
    expect(root.getAttribute('data-theme')).toBe('light');
  });

  it('turns round again on a third press and ends on the theme asked for last', async () => {
    const driver = createViewTransitionDriver();
    driver.switchTo('dark', { origin, apply });
    await fake.transitions[0].start();
    const [anim] = fake.animations;

    driver.switchTo('light', { origin, apply });
    driver.switchTo('dark', { origin, apply });
    expect(anim.reverse).toHaveBeenCalledTimes(2);
    expect(anim.playbackRate).toBe(1);

    anim.complete();
    fake.transitions[0].end();
    await flush();
    expect(applied).toEqual(['dark']);
    expect(root.getAttribute('data-theme')).toBe('dark');
  });

  it('pressed before the circle started: restores the old theme behind the snapshot', async () => {
    const driver = createViewTransitionDriver();
    driver.switchTo('dark', { origin, apply });
    driver.switchTo('light', { origin, apply });
    await fake.transitions[0].start();
    await flush();
    expect(fake.animations).toHaveLength(0);
    expect(applied).toEqual(['dark', 'light']);
    expect(fake.transitions[0].skipTransition).toHaveBeenCalled();
  });
});

describe('without View Transitions or with reduced motion', () => {
  it('switches at once', () => {
    delete document.startViewTransition;
    createViewTransitionDriver().switchTo('dark', { origin, apply });
    expect(applied).toEqual(['dark']);
  });

  it('honours prefers-reduced-motion', () => {
    window.matchMedia = vi.fn(() => ({ matches: true }));
    createViewTransitionDriver().switchTo('dark', { origin, apply });
    expect(applied).toEqual(['dark']);
    expect(document.startViewTransition).not.toHaveBeenCalled();
  });
});

describe('themeRevealRadius', () => {
  it('is 160% of the CSS reference length sqrt(w²+h²)/√2', () => {
    expect(themeRevealRadius(300, 400)).toBeCloseTo(1.6 * (500 / Math.SQRT2));
  });
});
