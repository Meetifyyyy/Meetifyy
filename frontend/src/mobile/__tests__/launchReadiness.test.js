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
  installLaunchReadiness({
    boot,
    maxWaitMs,
    now: () => frames * msPerFrame,
    nextFrame: (cb) => queue.push(cb),
    hasSurface: () => frames >= surfaceAfterFrames,
  });
  const tick = (n = 1) => {
    for (let i = 0; i < n; i += 1) {
      frames += 1;
      queue.splice(0).forEach((cb) => cb());
    }
  };
  return { boot, release, tick };
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
});
