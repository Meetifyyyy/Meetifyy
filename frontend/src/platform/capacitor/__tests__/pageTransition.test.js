/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const plugin = {
  begin: vi.fn(),
  play: vi.fn(),
  reverse: vi.fn(),
  finish: vi.fn(),
};
let platform = 'android';

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => platform, isPluginAvailable: () => true },
  registerPlugin: () => plugin,
}));

const { createNativePageTransitionDriver } = await import('../pageTransition');
const { notifyPageCommitted } = await import('@shared/lib/navigation/pageTransition');
const { SLIDE_MOTION } = await import('@shared/lib/navigation/slideTransition');
const { CENTRE_MOTION } = await import('@shared/lib/navigation/centreTransition');

const root = document.documentElement;
/** Resolves the play in progress with where the motion ended. */
let endPlay;
/** Navigations the driver performed, in order. */
let log;

/** A navigation that reaches the DOM a moment later, as the router's does. */
const navigation = (name) => vi.fn(() => {
  log.push(name);
  setTimeout(notifyPageCommitted, 0);
});

beforeEach(() => {
  log = [];
  platform = 'android';
  root.setAttribute('data-theme', 'light');
  vi.stubGlobal('requestAnimationFrame', (cb) => { setTimeout(cb, 0); return 1; });
  window.matchMedia = vi.fn(() => ({ matches: false }));
  plugin.begin.mockReset().mockImplementation(async () => { log.push('begin'); return {}; });
  plugin.finish.mockReset().mockImplementation(async () => { log.push('finish'); return {}; });
  plugin.reverse.mockReset().mockImplementation(async () => { log.push('reverse'); return {}; });
  plugin.play.mockReset().mockImplementation(({ direction }) => {
    log.push(`play:${direction}`);
    return new Promise((r) => { endPlay = r; });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  root.removeAttribute('data-theme');
});

const until = (assertion) => vi.waitFor(assertion, { timeout: 2000, interval: 2 });

describe('createNativePageTransitionDriver', () => {
  it('is null wherever the shell cannot draw the motion', () => {
    platform = 'web';
    expect(createNativePageTransitionDriver()).toBeNull();
    platform = 'ios';
    expect(createNativePageTransitionDriver()).toBeNull();
  });
});

describe('opening a page', () => {
  it('pictures the screen first, navigates under it, then plays the shared motion', async () => {
    const driver = createNativePageTransitionDriver();
    const go = navigation('go');
    driver.open(go);
    // Nothing navigates until the picture is up.
    expect(go).not.toHaveBeenCalled();

    await until(() => expect(plugin.play).toHaveBeenCalledTimes(1));
    expect(log).toEqual(['begin', 'go', 'play:open']);
    expect(plugin.play).toHaveBeenCalledWith({
      effect: 'slide',
      direction: 'open',
      duration: SLIDE_MOTION.open.duration,
      curve: { ...SLIDE_MOTION.open.curve },
      parallax: SLIDE_MOTION.parallax,
      dim: SLIDE_MOTION.dim.light,
      shadowWidth: SLIDE_MOTION.shadow.width,
      shadowAlpha: SLIDE_MOTION.shadow.alpha.light,
    });
    endPlay({ state: 'done' });
  });

  it('uses the dark dim and shadow on the dark theme', async () => {
    root.setAttribute('data-theme', 'dark');
    const driver = createNativePageTransitionDriver();
    driver.open(navigation('go'));
    await until(() => expect(plugin.play).toHaveBeenCalledTimes(1));
    expect(plugin.play.mock.calls[0][0]).toMatchObject({
      dim: SLIDE_MOTION.dim.dark,
      shadowAlpha: SLIDE_MOTION.shadow.alpha.dark,
    });
    endPlay({ state: 'done' });
  });

  it('takes one navigation at a time: a second open while one is moving is dropped', async () => {
    const driver = createNativePageTransitionDriver();
    const first = navigation('first');
    const second = navigation('second');
    driver.open(first);
    driver.open(second);
    await until(() => expect(plugin.play).toHaveBeenCalledTimes(1));
    driver.open(second);
    endPlay({ state: 'done' });
    await new Promise((r) => setTimeout(r, 10));
    expect(second).not.toHaveBeenCalled();
    expect(plugin.begin).toHaveBeenCalledTimes(1);
  });

  it('removes the picture without moving anything when the page never arrives', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const driver = createNativePageTransitionDriver();
      const go = vi.fn(); // never commits
      driver.open(go);
      await vi.waitFor(() => expect(go).toHaveBeenCalled());
      await vi.advanceTimersByTimeAsync(1300);
      await vi.waitFor(() => expect(plugin.finish).toHaveBeenCalledTimes(1));
      expect(plugin.play).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('navigates plainly, now and from then on, where the shell cannot capture', async () => {
    plugin.begin.mockRejectedValue(Object.assign(new Error('PixelCopy needs API 26'), { code: 'unsupported' }));
    const driver = createNativePageTransitionDriver();
    const go = navigation('go');
    driver.open(go);
    await until(() => expect(go).toHaveBeenCalledTimes(1));
    expect(plugin.play).not.toHaveBeenCalled();

    driver.open(go);
    expect(go).toHaveBeenCalledTimes(2);
    expect(plugin.begin).toHaveBeenCalledTimes(1);
  });

  it('navigates plainly when the user asks for reduced motion', () => {
    window.matchMedia = vi.fn(() => ({ matches: true }));
    const driver = createNativePageTransitionDriver();
    const go = vi.fn();
    driver.open(go);
    expect(go).toHaveBeenCalledTimes(1);
    expect(plugin.begin).not.toHaveBeenCalled();
  });
});

describe('closing a page', () => {
  it('pictures the page, steps back under it, then plays the motion the other way', async () => {
    const driver = createNativePageTransitionDriver();
    const back = navigation('back');
    driver.close(back, { animate: true });
    expect(back).not.toHaveBeenCalled();
    await until(() => expect(plugin.play).toHaveBeenCalledTimes(1));
    expect(log).toEqual(['begin', 'back', 'play:close']);
    expect(plugin.play.mock.calls[0][0]).toMatchObject({
      direction: 'close',
      effect: 'slide',
      duration: SLIDE_MOTION.close.duration,
    });
    endPlay({ state: 'done' });
  });

  it('steps back plainly from a page that was not opened with the motion', () => {
    const driver = createNativePageTransitionDriver();
    const back = vi.fn();
    driver.close(back, { animate: false });
    expect(back).toHaveBeenCalledTimes(1);
    expect(plugin.begin).not.toHaveBeenCalled();
  });

  it('shows nothing when the Back did not navigate (an overlay took it)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const driver = createNativePageTransitionDriver();
      const back = vi.fn(); // closes an overlay: no route commit
      driver.close(back, { animate: true });
      await vi.waitFor(() => expect(back).toHaveBeenCalled());
      await vi.advanceTimersByTimeAsync(1300);
      await vi.waitFor(() => expect(plugin.finish).toHaveBeenCalledTimes(1));
      expect(plugin.play).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores a second Back while the page is closing', async () => {
    const driver = createNativePageTransitionDriver();
    const back = navigation('back');
    driver.close(back, { animate: true });
    await until(() => expect(plugin.play).toHaveBeenCalledTimes(1));
    const again = vi.fn();
    driver.close(again, { animate: false });
    expect(again).not.toHaveBeenCalled();
    endPlay({ state: 'done' });
  });

  it('lands the close at once when the page coming back is tapped, then opens from there', async () => {
    const driver = createNativePageTransitionDriver();
    driver.close(navigation('back'), { animate: true });
    await until(() => expect(plugin.play).toHaveBeenCalledTimes(1));
    // finish() interrupts the play natively.
    plugin.finish.mockImplementationOnce(async () => {
      log.push('finish');
      endPlay({ state: 'done', interrupted: true });
      return {};
    });
    driver.open(navigation('open'));
    await until(() => expect(plugin.play).toHaveBeenCalledTimes(2));
    expect(log).toEqual(['begin', 'back', 'play:close', 'finish', 'begin', 'open', 'play:open']);
    endPlay({ state: 'done' });
  });
});

describe('the centre opening', () => {
  it('plays the centre motion, with the dip for the theme on screen', async () => {
    const driver = createNativePageTransitionDriver();
    driver.open(navigation('go'), { effect: 'centre' });
    await until(() => expect(plugin.play).toHaveBeenCalledTimes(1));
    expect(log).toEqual(['begin', 'go', 'play:open']);
    expect(plugin.play).toHaveBeenCalledWith({
      effect: 'centre',
      direction: 'open',
      duration: CENTRE_MOTION.open.duration,
      curve: { ...CENTRE_MOTION.open.curve },
      pictureScale: CENTRE_MOTION.open.pictureScale,
      fadeEnd: CENTRE_MOTION.open.fadeEnd,
      liveScale: CENTRE_MOTION.open.liveScale,
    });
    // The shell is told which effect it is capturing for: only the slide pre-rasters.
    expect(plugin.begin).toHaveBeenCalledWith({ effect: 'centre' });
    endPlay({ state: 'done' });
  });

  it('closes the page the same way it opened', async () => {
    const driver = createNativePageTransitionDriver();
    driver.close(navigation('back'), { animate: true, effect: 'centre' });
    await until(() => expect(plugin.play).toHaveBeenCalledTimes(1));
    expect(plugin.play.mock.calls[0][0]).toMatchObject({
      effect: 'centre',
      direction: 'close',
      duration: CENTRE_MOTION.close.duration,
      fadeEnd: CENTRE_MOTION.close.fadeEnd,
      earlyFadeEnd: CENTRE_MOTION.close.earlyFadeEnd,
      fadeEarly: [],
    });
    endPlay({ state: 'done' });
  });

  it('measures the early-fading elements while the page is still there, and hands them to the close', async () => {
    const button = document.createElement('button');
    button.setAttribute('data-page-fade-early', '');
    button.getBoundingClientRect = () => ({ left: 16, top: 700, right: 96, bottom: 744, width: 80, height: 44 });
    document.body.append(button);
    const driver = createNativePageTransitionDriver();
    // The navigation takes the page, and with it the button, away.
    const back = vi.fn(() => {
      button.remove();
      log.push('back');
      setTimeout(notifyPageCommitted, 0);
    });
    driver.close(back, { animate: true, effect: 'centre' });
    await until(() => expect(plugin.play).toHaveBeenCalledTimes(1));
    expect(document.body.contains(button)).toBe(false);
    expect(plugin.play.mock.calls[0][0].fadeEarly).toEqual([{ x: 16, y: 700, width: 80, height: 44 }]);
    endPlay({ state: 'done' });
  });

  it('asks nothing of the page for the slide', async () => {
    const driver = createNativePageTransitionDriver();
    driver.close(navigation('back'), { animate: true, effect: 'slide' });
    await until(() => expect(plugin.play).toHaveBeenCalledTimes(1));
    expect(plugin.play.mock.calls[0][0]).not.toHaveProperty('fadeEarly');
    endPlay({ state: 'done' });
  });

  it('plays the slide for an open that names no effect, or one it does not know', async () => {
    const driver = createNativePageTransitionDriver();
    driver.open(navigation('first'));
    await until(() => expect(plugin.play).toHaveBeenCalledTimes(1));
    expect(plugin.play.mock.calls[0][0].effect).toBe('slide');
    endPlay({ state: 'done' });
    await until(() => expect(driver.whenIdle()).resolves.toBeUndefined());

    driver.open(navigation('second'), { effect: 'wobble' });
    await until(() => expect(plugin.play).toHaveBeenCalledTimes(2));
    expect(plugin.play.mock.calls[1][0].effect).toBe('slide');
    endPlay({ state: 'done' });
  });

  it('closes with the centre opening when Back arrives just as the page does', async () => {
    plugin.reverse.mockImplementation(async () => ({ state: 'idle' }));
    const driver = createNativePageTransitionDriver();
    driver.open(navigation('open'), { effect: 'centre' });
    await until(() => expect(plugin.play).toHaveBeenCalledTimes(1));
    driver.close(navigation('back'), { animate: true, effect: 'centre' });
    endPlay({ state: 'done' });
    await until(() => expect(plugin.play).toHaveBeenCalledTimes(2));
    expect(plugin.play.mock.calls[1][0]).toMatchObject({ effect: 'centre', direction: 'close' });
    endPlay({ state: 'done' });
  });

  it('opens from the page coming back with the effect that open asked for', async () => {
    const driver = createNativePageTransitionDriver();
    driver.close(navigation('back'), { animate: true, effect: 'slide' });
    await until(() => expect(plugin.play).toHaveBeenCalledTimes(1));
    plugin.finish.mockImplementationOnce(async () => {
      log.push('finish');
      endPlay({ state: 'done', interrupted: true });
      return {};
    });
    driver.open(navigation('open'), { effect: 'centre' });
    await until(() => expect(plugin.play).toHaveBeenCalledTimes(2));
    expect(plugin.play.mock.calls[1][0]).toMatchObject({ effect: 'centre', direction: 'open' });
    endPlay({ state: 'done' });
  });
});

describe('Back while a page is opening', () => {
  it('turns the moving page round, then undoes the navigation under the picture', async () => {
    const driver = createNativePageTransitionDriver();
    driver.open(navigation('open'));
    await until(() => expect(plugin.play).toHaveBeenCalledTimes(1));

    const back = navigation('back');
    driver.close(back, { animate: true });
    expect(plugin.reverse).toHaveBeenCalledTimes(1);
    // Nothing navigates while the page is still sliding back out.
    expect(back).not.toHaveBeenCalled();

    endPlay({ state: 'reversed' });
    await until(() => expect(plugin.finish).toHaveBeenCalledTimes(1));
    expect(log).toEqual(['begin', 'open', 'play:open', 'reverse', 'back', 'finish']);
  });

  it('abandons the open when Back comes before anything has changed', async () => {
    let release;
    plugin.begin.mockImplementation(() => new Promise((r) => { release = r; }));
    const driver = createNativePageTransitionDriver();
    const open = navigation('open');
    const back = navigation('back');
    driver.open(open);
    driver.close(back, { animate: true });
    release({});
    await until(() => expect(plugin.finish).toHaveBeenCalledTimes(1));
    // The feed never left the screen, so there is no navigation to undo.
    expect(open).not.toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();
    expect(plugin.play).not.toHaveBeenCalled();
  });

  it('closes normally when Back lands just as the page arrives', async () => {
    plugin.reverse.mockImplementation(async () => ({ state: 'idle' }));
    const driver = createNativePageTransitionDriver();
    driver.open(navigation('open'));
    await until(() => expect(plugin.play).toHaveBeenCalledTimes(1));
    driver.close(navigation('back'), { animate: true });
    endPlay({ state: 'done' });
    await until(() => expect(plugin.play).toHaveBeenCalledTimes(2));
    expect(plugin.play.mock.calls[1][0].direction).toBe('close');
    expect(log.slice(-3)).toEqual(['begin', 'back', 'play:close']);
    endPlay({ state: 'done' });
  });
});

describe('whenIdle', () => {
  it('resolves at once with nothing moving, and after the motion otherwise', async () => {
    const driver = createNativePageTransitionDriver();
    await expect(driver.whenIdle()).resolves.toBeUndefined();

    driver.open(navigation('open'));
    await until(() => expect(plugin.play).toHaveBeenCalledTimes(1));
    let settled = false;
    driver.whenIdle().then(() => { settled = true; });
    await new Promise((r) => setTimeout(r, 10));
    expect(settled).toBe(false);
    endPlay({ state: 'done' });
    await until(() => expect(settled).toBe(true));
  });
});
