import { describe, expect, it, vi } from 'vitest';
import {
  isStaleChunkError,
  recoverFromStaleChunk,
  clearStaleChunkMarker,
} from '../staleChunkRecovery';

const makeStorage = (initial = {}) => {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
    _size: () => map.size,
  };
};

describe('isStaleChunkError', () => {
  it.each([
    ['Chrome/Edge', 'Failed to fetch dynamically imported module: https://x/a.js'],
    ['Firefox', 'error loading dynamically imported module'],
    ['Safari', 'Importing a module script failed.'],
  ])('recognises the %s wording', (_browser, message) => {
    // Matching only Chrome's phrasing would leave Firefox and Safari users
    // stuck on the dead route.
    expect(isStaleChunkError(new Error(message))).toBe(true);
  });

  it('accepts a bare string as well as an Error', () => {
    expect(isStaleChunkError('Failed to fetch dynamically imported module')).toBe(
      true
    );
  });

  it('does not match ordinary errors', () => {
    // A false positive here would turn a normal bug into a reload loop.
    for (const message of [
      'Cannot read properties of undefined',
      'Network request failed',
      'Failed to fetch',
      'TypeError: x is not a function',
    ]) {
      expect(isStaleChunkError(new Error(message))).toBe(false);
    }
    expect(isStaleChunkError(null)).toBe(false);
    expect(isStaleChunkError(undefined)).toBe(false);
  });
});

describe('recoverFromStaleChunk', () => {
  const staleError = new Error('Failed to fetch dynamically imported module');

  it('reloads once for a stale-chunk error', () => {
    const reload = vi.fn();
    const storage = makeStorage();

    expect(
      recoverFromStaleChunk(staleError, { storage, reload })
    ).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload twice — a broken deploy must not loop the tab', () => {
    const reload = vi.fn();
    const storage = makeStorage();
    let clock = 1_000_000;
    const now = () => clock;

    expect(recoverFromStaleChunk(staleError, { storage, reload, now })).toBe(true);

    // The reload happened, the route still fails: this is not staleness, so the
    // error screen should show rather than another reload firing.
    clock += 5_000;
    expect(recoverFromStaleChunk(staleError, { storage, reload, now })).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('allows recovery again once the cooldown has passed', () => {
    // A tab left open across two separate deploys should survive the second.
    const reload = vi.fn();
    const storage = makeStorage();
    let clock = 1_000_000;
    const now = () => clock;

    recoverFromStaleChunk(staleError, { storage, reload, now });
    clock += 61_000;
    expect(recoverFromStaleChunk(staleError, { storage, reload, now })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('never reloads for an ordinary error', () => {
    const reload = vi.fn();
    expect(
      recoverFromStaleChunk(new Error('something else'), {
        storage: makeStorage(),
        reload,
      })
    ).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('declines to reload when storage is unavailable', () => {
    // Without a marker there is no way to guarantee one-shot behaviour, and a
    // possible reload loop is a worse failure than a visible error screen.
    const reload = vi.fn();
    const throwing = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
    };
    expect(recoverFromStaleChunk(staleError, { storage: throwing, reload })).toBe(
      false
    );
    expect(reload).not.toHaveBeenCalled();
  });

  it('clears its marker so a later deploy can recover cleanly', () => {
    const storage = makeStorage();
    recoverFromStaleChunk(staleError, { storage, reload: () => {} });
    expect(storage._size()).toBe(1);
    clearStaleChunkMarker(storage);
    expect(storage._size()).toBe(0);
  });
});
