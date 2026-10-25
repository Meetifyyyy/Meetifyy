import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PAGE_EFFECT,
  PAGE_TRANSITION_STATE_KEY,
  afterPageTransition,
  closePage,
  entryOpenedWithTransition,
  isPageEffect,
  keepPageTransition,
  nextPageCommit,
  notifyPageCommitted,
  openPage,
  pageEffectOfEntry,
  pageEffectOrDefault,
  pageEffectPlayArgs,
  pageEffectSnapshot,
  setPageTransitionDriver,
  withPageTransition,
} from '../pageTransition';
import { CENTRE_EFFECT, CENTRE_MOTION } from '../centreTransition';
import { SLIDE_EFFECT, SLIDE_MOTION } from '../slideTransition';

afterEach(() => {
  setPageTransitionDriver(null);
  vi.useRealTimers();
});

describe('without a driver (the website)', () => {
  it('opens and closes by running the navigation at once, synchronously', () => {
    const go = vi.fn();
    openPage(go);
    expect(go).toHaveBeenCalledTimes(1);
    closePage(go, { usr: { [PAGE_TRANSITION_STATE_KEY]: 'slide' } });
    expect(go).toHaveBeenCalledTimes(2);
  });

  it('leaves the router state exactly as the caller passed it', () => {
    const state = { post: { id: 'p1' } };
    expect(withPageTransition(state)).toBe(state);
    expect(withPageTransition(undefined)).toBeUndefined();
  });
});

describe('with a driver (the app)', () => {
  const driver = { open: vi.fn(), close: vi.fn() };
  const install = () => {
    driver.open.mockReset();
    driver.close.mockReset();
    setPageTransitionDriver(driver);
  };

  it('hands the navigation to the driver instead of running it', () => {
    install();
    const go = vi.fn();
    openPage(go);
    expect(go).not.toHaveBeenCalled();
    expect(driver.open).toHaveBeenCalledWith(go, { effect: SLIDE_EFFECT });
  });

  it('opens with the effect it is asked for, and the slide when it is not asked', () => {
    install();
    const go = vi.fn();
    openPage(go, CENTRE_EFFECT);
    expect(driver.open).toHaveBeenLastCalledWith(go, { effect: CENTRE_EFFECT });
    openPage(go, 'wobble');
    expect(driver.open).toHaveBeenLastCalledWith(go, { effect: SLIDE_EFFECT });
  });

  it('marks the entry it opens, keeping what the caller put in the state', () => {
    install();
    expect(withPageTransition({ post: { id: 'p1' } })).toEqual({
      post: { id: 'p1' },
      [PAGE_TRANSITION_STATE_KEY]: 'slide',
    });
    expect(withPageTransition(null)).toEqual({ [PAGE_TRANSITION_STATE_KEY]: 'slide' });
  });

  it('marks the entry with the effect it opened with, so Back can replay it', () => {
    install();
    expect(withPageTransition({ post: { id: 'p1' } }, CENTRE_EFFECT)).toEqual({
      post: { id: 'p1' },
      [PAGE_TRANSITION_STATE_KEY]: 'centre',
    });
    expect(withPageTransition(null, 'wobble')).toEqual({ [PAGE_TRANSITION_STATE_KEY]: 'slide' });
  });

  it('closes with the motion only from an entry that was opened with it', () => {
    install();
    const go = vi.fn();
    closePage(go, { usr: { [PAGE_TRANSITION_STATE_KEY]: 'slide' }, idx: 3 });
    expect(driver.close).toHaveBeenLastCalledWith(go, { animate: true, effect: SLIDE_EFFECT });
    closePage(go, { usr: { post: { id: 'p1' } }, idx: 3 });
    expect(driver.close).toHaveBeenLastCalledWith(go, { animate: false, effect: SLIDE_EFFECT });
  });

  it('closes with the effect the entry was opened with', () => {
    install();
    const go = vi.fn();
    closePage(go, { usr: { [PAGE_TRANSITION_STATE_KEY]: 'centre' }, idx: 3 });
    expect(driver.close).toHaveBeenLastCalledWith(go, { animate: true, effect: CENTRE_EFFECT });
    // A mark this build does not know (an older or newer one wrote it) is not a motion.
    closePage(go, { usr: { [PAGE_TRANSITION_STATE_KEY]: 'wobble' }, idx: 3 });
    expect(driver.close).toHaveBeenLastCalledWith(go, { animate: false, effect: SLIDE_EFFECT });
  });
});

describe('the effects', () => {
  it('knows the slide and the centre opening, and the slide is the default', () => {
    expect(isPageEffect('slide')).toBe(true);
    expect(isPageEffect('centre')).toBe(true);
    expect(isPageEffect('wobble')).toBe(false);
    expect(isPageEffect(undefined)).toBe(false);
    expect(isPageEffect('toString')).toBe(false);
    expect(DEFAULT_PAGE_EFFECT).toBe('slide');
    expect(pageEffectOrDefault('centre')).toBe('centre');
    expect(pageEffectOrDefault('nope')).toBe('slide');
  });

  it('gives the shell the slide\'s motion, with the dim and shadow for the theme', () => {
    expect(pageEffectPlayArgs('slide', 'open', false)).toEqual({
      effect: 'slide',
      direction: 'open',
      duration: SLIDE_MOTION.open.duration,
      curve: { ...SLIDE_MOTION.open.curve },
      parallax: SLIDE_MOTION.parallax,
      dim: SLIDE_MOTION.dim.light,
      shadowWidth: SLIDE_MOTION.shadow.width,
      shadowAlpha: SLIDE_MOTION.shadow.alpha.light,
    });
    expect(pageEffectPlayArgs('slide', 'close', true)).toMatchObject({
      direction: 'close',
      duration: SLIDE_MOTION.close.duration,
      dim: SLIDE_MOTION.dim.dark,
      shadowAlpha: SLIDE_MOTION.shadow.alpha.dark,
    });
  });

  it('gives the shell the centre opening\'s motion, the same in either theme', () => {
    const open = {
      effect: 'centre',
      direction: 'open',
      duration: CENTRE_MOTION.open.duration,
      curve: { ...CENTRE_MOTION.open.curve },
      pictureScale: CENTRE_MOTION.open.pictureScale,
      fadeEnd: CENTRE_MOTION.open.fadeEnd,
      liveScale: CENTRE_MOTION.open.liveScale,
    };
    expect(pageEffectPlayArgs('centre', 'open', false)).toEqual(open);
    expect(pageEffectPlayArgs('centre', 'open', true)).toEqual(open);
  });

  it('adds what only a close needs: when the early elements are gone, and where they are', () => {
    const rects = [{ x: 10, y: 600, width: 80, height: 40 }];
    expect(pageEffectPlayArgs('centre', 'close', false, rects)).toEqual({
      effect: 'centre',
      direction: 'close',
      duration: CENTRE_MOTION.close.duration,
      curve: { ...CENTRE_MOTION.close.curve },
      pictureScale: CENTRE_MOTION.close.pictureScale,
      fadeEnd: CENTRE_MOTION.close.fadeEnd,
      earlyFadeEnd: CENTRE_MOTION.close.earlyFadeEnd,
      fadeEarly: rects,
    });
    // Nothing measured is an empty list, never a missing one.
    expect(pageEffectPlayArgs('centre', 'close', false).fadeEarly).toEqual([]);
    // An open never carries them.
    expect(pageEffectPlayArgs('centre', 'open', false, rects)).not.toHaveProperty('fadeEarly');
  });

  it('plays a name it does not know as the default rather than throwing', () => {
    expect(pageEffectPlayArgs('wobble', 'open', false).effect).toBe('slide');
  });

  it('leaves the live page alone: only the screenshot is scaled', () => {
    // Scaling the WebView makes Chromium re-raster the page on every frame.
    expect(CENTRE_MOTION.open.liveScale).toBe(1);
    expect(pageEffectPlayArgs('centre', 'close', false)).not.toHaveProperty('liveScale');
    expect(CENTRE_MOTION.open.pictureScale).toBeGreaterThan(1);
  });

  it('opens and closes in opposite directions: grows going in, shrinks coming back', () => {
    expect(CENTRE_MOTION.open.pictureScale).toBeGreaterThan(1);
    expect(CENTRE_MOTION.close.pictureScale).toBeLessThan(1);
  });

  it('only shrinks the closing picture, which has the live page round it', () => {
    // A page beneath smaller than the screen shows a band of another page's colour round it.
    const scales = Object.entries(pageEffectPlayArgs('centre', 'open', false))
      .filter(([name]) => /scale/i.test(name))
      .map(([, value]) => value);
    expect(scales.length).toBeGreaterThan(0);
    for (const scale of scales) expect(scale).toBeGreaterThanOrEqual(1);
    const closing = Object.keys(pageEffectPlayArgs('centre', 'close', false)).filter((name) => /scale/i.test(name));
    expect(closing).toEqual(['pictureScale']);
  });

  it('has the page being left gone before the motion ends, and the early elements before that', () => {
    expect(CENTRE_MOTION.close.fadeEnd).toBeLessThan(1);
    expect(CENTRE_MOTION.close.earlyFadeEnd).toBeLessThan(CENTRE_MOTION.close.fadeEnd);
    expect(CENTRE_MOTION.open.fadeEnd).toBeLessThanOrEqual(1);
  });

  it('asks only the effect that needs it what the page being left looks like', () => {
    expect(pageEffectSnapshot('slide')).toBeNull();
    expect(pageEffectSnapshot('centre')).toEqual([]);
  });
});

describe('entryOpenedWithTransition', () => {
  it('reads the effect of the mark React Router keeps under `usr`', () => {
    expect(pageEffectOfEntry({ usr: { [PAGE_TRANSITION_STATE_KEY]: 'slide' } })).toBe('slide');
    expect(pageEffectOfEntry({ usr: { [PAGE_TRANSITION_STATE_KEY]: 'centre' } })).toBe('centre');
    expect(pageEffectOfEntry({ usr: { from: '/home' } })).toBeNull();
    expect(pageEffectOfEntry(null)).toBeNull();
  });

  it('reads the mark React Router keeps under `usr`', () => {
    expect(entryOpenedWithTransition({ usr: { [PAGE_TRANSITION_STATE_KEY]: 'slide' } })).toBe(true);
    expect(entryOpenedWithTransition({ usr: { [PAGE_TRANSITION_STATE_KEY]: 'centre' } })).toBe(true);
    expect(entryOpenedWithTransition({ usr: { from: '/home' } })).toBe(false);
    expect(entryOpenedWithTransition({ [PAGE_TRANSITION_STATE_KEY]: 'slide' })).toBe(false);
    expect(entryOpenedWithTransition(null)).toBe(false);
  });

  it("never treats an overlay's entry as the page: Back there closes the overlay", () => {
    expect(entryOpenedWithTransition({
      usr: { __overlayId: 'sheet', [PAGE_TRANSITION_STATE_KEY]: 'slide' },
    })).toBe(false);
    expect(entryOpenedWithTransition({
      __overlayId: 'sheet',
      usr: { [PAGE_TRANSITION_STATE_KEY]: 'slide' },
    })).toBe(false);
  });
});

describe('nextPageCommit', () => {
  it('resolves true on the next reported commit, once', async () => {
    const landed = nextPageCommit(1000);
    notifyPageCommitted();
    await expect(landed).resolves.toBe(true);
    // A later commit has no one left listening.
    expect(() => notifyPageCommitted()).not.toThrow();
  });

  it('resolves false when nothing commits in time', async () => {
    vi.useFakeTimers();
    const landed = nextPageCommit(500);
    vi.advanceTimersByTime(500);
    await expect(landed).resolves.toBe(false);
  });
});

describe('keepPageTransition', () => {
  it('keeps only the mark when a page rewrites its own entry', () => {
    expect(keepPageTransition({ autoFocus: true, [PAGE_TRANSITION_STATE_KEY]: 'slide' }))
      .toEqual({ [PAGE_TRANSITION_STATE_KEY]: 'slide' });
    expect(keepPageTransition({ autoFocus: true, [PAGE_TRANSITION_STATE_KEY]: 'centre' }))
      .toEqual({ [PAGE_TRANSITION_STATE_KEY]: 'centre' });
    expect(keepPageTransition({ autoFocus: true })).toBeNull();
    expect(keepPageTransition(null)).toBeNull();
  });
});

describe('afterPageTransition', () => {
  it('runs at once without a driver', () => {
    const fn = vi.fn();
    afterPageTransition(fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('waits for the driver to be idle', async () => {
    let idle;
    setPageTransitionDriver({ open: vi.fn(), close: vi.fn(), whenIdle: () => new Promise((r) => { idle = r; }) });
    const fn = vi.fn();
    afterPageTransition(fn);
    await Promise.resolve();
    expect(fn).not.toHaveBeenCalled();
    idle();
    await vi.waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
  });
});
