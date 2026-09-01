import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  beginDeletionCountdown,
  endDeletionCountdown,
  isDeletionCountdownActive,
} from '../deletionHandoff';

const makeStorage = () => {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
    _set: (k, v) => map.set(k, v),
    _size: () => map.size,
  };
};

afterEach(() => vi.useRealTimers());

describe('deletion countdown handoff', () => {
  it('is inactive until a countdown begins', () => {
    const storage = makeStorage();
    expect(isDeletionCountdownActive(storage)).toBe(false);
  });

  it('suppresses the gate while the countdown is running', () => {
    // Otherwise the user confirms their deletion and watches the confirmation
    // vanish, replaced by a screen offering to undo it.
    const storage = makeStorage();
    beginDeletionCountdown(storage);
    expect(isDeletionCountdownActive(storage)).toBe(true);
  });

  it('stops suppressing once the countdown ends', () => {
    const storage = makeStorage();
    beginDeletionCountdown(storage);
    endDeletionCountdown(storage);
    expect(isDeletionCountdownActive(storage)).toBe(false);
  });

  it('expires on its own, so a restored tab cannot suppress the gate forever', () => {
    const storage = makeStorage();
    beginDeletionCountdown(storage);

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 61_000);
    expect(isDeletionCountdownActive(storage)).toBe(false);
    // And the stale marker is cleaned up rather than re-read every render.
    expect(storage._size()).toBe(0);
  });

  it('ignores a corrupt marker rather than trusting it', () => {
    const storage = makeStorage();
    storage._set('meetifyy:deletion-countdown', 'not-a-number');
    expect(isDeletionCountdownActive(storage)).toBe(false);
  });

  it('never throws when storage is unavailable', () => {
    // Private mode. The gate takes over sooner, which is a worse handoff but
    // not a broken one — both screens say the same thing.
    const throwing = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    };
    expect(() => beginDeletionCountdown(throwing)).not.toThrow();
    expect(() => endDeletionCountdown(throwing)).not.toThrow();
    expect(isDeletionCountdownActive(throwing)).toBe(false);
  });
});
