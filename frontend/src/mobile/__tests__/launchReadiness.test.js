import { describe, it, expect, vi } from 'vitest';
import { installLaunchReadiness } from '../launchReadiness';

/**
 * The splash may lift only onto a painted screen, and never waits long.
 * Frames are driven by hand so each case states exactly how many elapse.
 */
function harness({ surfaceAfterFrames = Infinity, maxWaitMs = 900, msPerFrame = 16 } = {}) {
  const release = vi.fn(() => { boot.appReady = true; });
  const boot = { appReady: false, ready: release };
  let frames = 0;
  const queue = [];
  const timers = [];
  installLaunchReadiness({
    boot,
    maxWaitMs,
    now: () => frames * msPerFrame,
    nextFrame: (cb) => queue.push(cb),
    hasSurface: () => frames >= surfaceAfterFrames,
    later: (cb, ms) => timers.push({ cb, ms }),
  });
  const tick = (n = 1) => {
    for (let i = 0; i < n; i += 1) {
      frames += 1;
      queue.splice(0).forEach((cb) => cb());
    }
  };
  const fireTimers = () => timers.splice(0).forEach((t) => t.cb());
  return { boot, release, tick, timers, fireTimers };
}

describe('launch readiness', () => {
  it('releases two frames after the screen is already there', () => {
    const { boot, release, tick } = harness({ surfaceAfterFrames: 0 });
    boot.ready();
    expect(release).not.toHaveBeenCalled();
    tick(2);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('waits for the screen to appear, then two more frames', () => {
    const { boot, release, tick } = harness({ surfaceAfterFrames: 5 });
    boot.ready();
    tick(5);
    expect(release).not.toHaveBeenCalled();
    tick(2);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('never holds the splash past the cap', () => {
    const { boot, release, tick } = harness({ maxWaitMs: 160, msPerFrame: 16 });
    boot.ready();
    tick(9);
    expect(release).not.toHaveBeenCalled();
    tick(3);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('releases once however often ready() is called', () => {
    const { boot, release, tick } = harness({ surfaceAfterFrames: 0 });
    boot.ready();
    boot.ready();
    tick(4);
    boot.ready();
    tick(4);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('does nothing when there is no boot object (web)', () => {
    expect(() => installLaunchReadiness({ boot: undefined })).not.toThrow();
  });

  it('still releases on time when frames stop arriving', () => {
    const { boot, release, timers, fireTimers } = harness({ surfaceAfterFrames: 0 });
    boot.ready();
    expect(timers[0].ms).toBeGreaterThan(900);
    fireTimers(); // no frame has run at all
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('releases once when the frames win and the timer fires later', () => {
    const { boot, release, tick, fireTimers } = harness({ surfaceAfterFrames: 0 });
    boot.ready();
    tick(2);
    fireTimers();
    expect(release).toHaveBeenCalledTimes(1);
  });

  describe('fully drawn', () => {
    /** A harness whose content watcher is driven by hand. */
    function contentHarness({ contentAtRelease = false } = {}) {
      const release = vi.fn();
      const boot = { appReady: false, ready: release };
      const onFullyDrawn = vi.fn();
      const queue = [];
      const timers = [];
      let notify = null;
      const stop = vi.fn();
      const watchContent = vi.fn((found) => {
        if (contentAtRelease) {
          found();
          return stop;
        }
        notify = found;
        return stop;
      });
      installLaunchReadiness({
        boot, now: () => 0, nextFrame: (cb) => queue.push(cb), hasSurface: () => true,
        later: (cb, ms) => timers.push({ cb, ms }), onFullyDrawn, watchContent, fullyDrawnMaxMs: 15000,
      });
      const frames = (n) => { for (let i = 0; i < n; i += 1) queue.splice(0).forEach((cb) => cb()); };
      return { boot, release, onFullyDrawn, watchContent, stop, frames, timers, appear: () => notify?.() };
    }

    it('does not look for content before the splash is released', () => {
      const { boot, watchContent } = contentHarness();
      boot.ready();
      expect(watchContent).not.toHaveBeenCalled();
    });

    it('reports once the first content appears after the release', () => {
      const { boot, onFullyDrawn, frames, appear, stop } = contentHarness();
      boot.ready();
      frames(2);
      expect(onFullyDrawn).not.toHaveBeenCalled();
      appear();
      expect(onFullyDrawn).toHaveBeenCalledTimes(1);
      expect(stop).toHaveBeenCalled();
      appear();
      expect(onFullyDrawn).toHaveBeenCalledTimes(1);
    });

    it('reports at once when the content is already there', () => {
      const { boot, onFullyDrawn, frames } = contentHarness({ contentAtRelease: true });
      boot.ready();
      frames(2);
      expect(onFullyDrawn).toHaveBeenCalledTimes(1);
    });

    it('stops watching, reporting nothing, when no content comes', () => {
      const { boot, onFullyDrawn, frames, timers, appear, stop } = contentHarness();
      boot.ready();
      frames(2);
      const cap = timers.find((t) => t.ms === 15000);
      expect(cap).toBeTruthy();
      cap.cb();
      expect(stop).toHaveBeenCalled();
      appear();
      expect(onFullyDrawn).not.toHaveBeenCalled();
    });
  });

  it('tells native as it releases, exactly once', () => {
    const onRelease = vi.fn();
    const release = vi.fn();
    const boot = { appReady: false, ready: release };
    const queue = [];
    const timers = [];
    installLaunchReadiness({
      boot, now: () => 0, nextFrame: (cb) => queue.push(cb), hasSurface: () => true,
      later: (cb) => timers.push(cb), onRelease,
    });
    boot.ready();
    queue.splice(0).forEach((cb) => cb());
    queue.splice(0).forEach((cb) => cb());
    timers.forEach((cb) => cb());
    expect(release).toHaveBeenCalledTimes(1);
    expect(onRelease).toHaveBeenCalledTimes(1);
  });
});
