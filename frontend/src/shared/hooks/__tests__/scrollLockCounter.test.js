import { describe, expect, it, vi } from 'vitest';
import { createScrollLockCounter } from '../scrollLockCounter';

const makeLock = () => {
  const effects = { engage: vi.fn(), release: vi.fn() };
  return { lock: createScrollLockCounter(effects), effects };
};

describe('a single overlay', () => {
  it('locks on open and unlocks on close', () => {
    const { lock, effects } = makeLock();
    lock.acquire();
    expect(effects.engage).toHaveBeenCalledTimes(1);
    expect(effects.release).not.toHaveBeenCalled();

    lock.release();
    expect(effects.release).toHaveBeenCalledTimes(1);
    expect(lock.count).toBe(0);
  });
});

describe('nested overlays', () => {
  it('engages once, however many are open', () => {
    // The second overlay must not re-snapshot the DOM: it would capture the
    // first overlay's `hidden` as though it were the original value.
    const { lock, effects } = makeLock();
    lock.acquire();
    lock.acquire();
    lock.acquire();
    expect(effects.engage).toHaveBeenCalledTimes(1);
    expect(lock.count).toBe(3);
  });

  it('stays locked while any overlay is still open', () => {
    const { lock, effects } = makeLock();
    lock.acquire();
    lock.acquire();

    lock.release();
    expect(effects.release).not.toHaveBeenCalled();

    lock.release();
    expect(effects.release).toHaveBeenCalledTimes(1);
  });

  it('does not care what order they close in', () => {
    /**
     * The exact defect. Per-instance state meant whichever overlay unmounted
     * FIRST wrote its captured values back, so closing in the order they opened
     * unlocked the page while the later overlay was still on screen.
     */
    const { lock, effects } = makeLock();
    lock.acquire(); // share sheet
    lock.acquire(); // confirm dialog on top of it

    // The one that opened first closes first.
    lock.release();
    expect(effects.release).not.toHaveBeenCalled();
    expect(lock.count).toBe(1);

    lock.release();
    expect(effects.release).toHaveBeenCalledTimes(1);
  });

  it('re-locks cleanly for the next overlay', () => {
    const { lock, effects } = makeLock();
    lock.acquire();
    lock.release();
    lock.acquire();
    expect(effects.engage).toHaveBeenCalledTimes(2);
    expect(lock.count).toBe(1);
  });
});

describe('unbalanced releases', () => {
  it('never lets the count go negative', () => {
    /**
     * A cleanup can run twice: StrictMode double-invokes effects in
     * development, and a fast unmount/remount can interleave them. A negative
     * count would need two acquires before the lock engaged again, so the NEXT
     * overlay would not lock the page at all — silent, and only visible as
     * "scrolling works behind this one modal sometimes".
     */
    const { lock, effects } = makeLock();
    lock.acquire();
    lock.release();
    lock.release();
    lock.release();
    expect(lock.count).toBe(0);

    lock.acquire();
    expect(effects.engage).toHaveBeenCalledTimes(2);
  });

  it('does not release repeatedly once already unlocked', () => {
    const { lock, effects } = makeLock();
    lock.acquire();
    lock.release();
    expect(effects.release).toHaveBeenCalledTimes(1);
    // Further releases are ignored entirely: the DOM restore must not be
    // replayed over values it has already put back.
    lock.release();
    lock.release();
    expect(lock.count).toBe(0);
    expect(effects.release).toHaveBeenCalledTimes(1);
  });
});
