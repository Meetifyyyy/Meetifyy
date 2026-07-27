import { describe, it, expect, vi, beforeEach } from 'vitest';
import { coalescer } from '../requestCoalescer';

describe('RequestCoalescer Unit & Stress Tests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    coalescer.timers.clear();
    coalescer.controllers.clear();
  });

  it('should coalesce 50 rapid schedule calls into 1 single callback execution', () => {
    const callback = vi.fn();
    const key = 'likePost:stress-1';

    for (let i = 0; i < 50; i++) {
      coalescer.schedule(key, callback, 200);
      vi.advanceTimersByTime(10); // Advance 10ms per click (within 200ms window)
    }

    // Advance remaining time for final timer
    vi.advanceTimersByTime(250);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(expect.any(AbortSignal));
  });

  it('should abort in-flight controller when a new schedule call occurs after emission', () => {
    const callback1 = vi.fn();
    const callback2 = vi.fn();
    const key = 'follow:user-123';

    coalescer.schedule(key, callback1, 100);
    vi.advanceTimersByTime(150); // timer 1 fires, callback1 called with signal1

    const signal1 = callback1.mock.calls[0][0];
    expect(signal1.aborted).toBe(false);

    // Call schedule again while signal1 is still in-flight
    coalescer.schedule(key, callback2, 100);

    // Assert signal1 was immediately aborted!
    expect(signal1.aborted).toBe(true);
  });
});
