import { describe, expect, it, vi } from 'vitest';
import {
  applyAccountStatusCorrection,
  ACCOUNT_STATUS_EVENT,
} from '../accountStatusCorrection';

/** Minimal localStorage stand-in, so these run without a DOM. */
const makeStorage = (initial) => {
  const map = new Map(Object.entries(initial ?? {}));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    _read: (k) => map.get(k),
  };
};

const makeEmitter = () => {
  const events = [];
  return { dispatchEvent: (e) => events.push(e), events };
};

const activeUser = { id: 'u1', username: 'sam', accountStatus: 'ACTIVE' };

describe('applyAccountStatusCorrection', () => {
  it.each([
    ['ACCOUNT_PENDING_DELETION', 'PENDING_DELETION'],
    ['ACCOUNT_SUSPENDED', 'SUSPENDED'],
  ])('%s corrects the cached profile to %s', (code, expected) => {
    const storage = makeStorage({ currentUser: JSON.stringify(activeUser) });
    const emitter = makeEmitter();

    expect(applyAccountStatusCorrection(code, { storage, emitter })).toBe(
      expected,
    );
    expect(JSON.parse(storage._read('currentUser'))).toMatchObject({
      id: 'u1',
      username: 'sam',
      accountStatus: expected,
    });
  });

  it('notifies same-tab listeners, which never receive their own storage event', () => {
    const storage = makeStorage({ currentUser: JSON.stringify(activeUser) });
    const emitter = makeEmitter();

    applyAccountStatusCorrection('ACCOUNT_PENDING_DELETION', {
      storage,
      emitter,
    });

    expect(emitter.events).toHaveLength(1);
    expect(emitter.events[0].type).toBe(ACCOUNT_STATUS_EVENT);
    expect(emitter.events[0].detail).toEqual({ status: 'PENDING_DELETION' });
  });

  it('can only ever restrict, never unlock', () => {
    // The whitelist has no entry that returns an account to ACTIVE, so a forged
    // or replayed 403 can lock this tab's UI but never open it. Unlocking is
    // server-authoritative — recovery, or a real sync.
    const storage = makeStorage({
      currentUser: JSON.stringify({ ...activeUser, accountStatus: 'PENDING_DELETION' }),
    });

    for (const code of ['ACCOUNT_ACTIVE', 'ACTIVE', 'RECOVERED', 'anything']) {
      expect(applyAccountStatusCorrection(code, { storage })).toBeNull();
    }
    expect(JSON.parse(storage._read('currentUser')).accountStatus).toBe(
      'PENDING_DELETION',
    );
  });

  it('is a no-op when the status already matches', () => {
    // Otherwise every subsequent 403 would re-write storage and fire a pointless
    // event in every other tab.
    const storage = makeStorage({
      currentUser: JSON.stringify({ ...activeUser, accountStatus: 'SUSPENDED' }),
    });
    const emitter = makeEmitter();

    expect(
      applyAccountStatusCorrection('ACCOUNT_SUSPENDED', { storage, emitter }),
    ).toBeNull();
    expect(emitter.events).toHaveLength(0);
  });

  it('ignores codes that carry no lifecycle meaning', () => {
    const storage = makeStorage({ currentUser: JSON.stringify(activeUser) });
    // A 403 from the activity policy must not touch the account status.
    expect(
      applyAccountStatusCorrection('COLLEGE_RESTRICTED', { storage }),
    ).toBeNull();
    expect(applyAccountStatusCorrection(undefined, { storage })).toBeNull();
    expect(JSON.parse(storage._read('currentUser')).accountStatus).toBe('ACTIVE');
  });

  it('does nothing when nobody is signed in', () => {
    const storage = makeStorage({});
    expect(
      applyAccountStatusCorrection('ACCOUNT_PENDING_DELETION', { storage }),
    ).toBeNull();
  });

  it('never throws when storage is unavailable or the cache is corrupt', () => {
    // Private mode, a quota failure, or a half-written value. None of these may
    // break the request path this runs inside.
    const throwing = {
      getItem: vi.fn(() => {
        throw new Error('SecurityError');
      }),
      setItem: vi.fn(),
    };
    expect(() =>
      applyAccountStatusCorrection('ACCOUNT_SUSPENDED', { storage: throwing }),
    ).not.toThrow();

    const corrupt = makeStorage({ currentUser: '{not json' });
    expect(
      applyAccountStatusCorrection('ACCOUNT_SUSPENDED', { storage: corrupt }),
    ).toBeNull();

    expect(
      applyAccountStatusCorrection('ACCOUNT_SUSPENDED', { storage: null }),
    ).toBeNull();
  });
});
