import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

import {
  followStateKey,
  readFollowState,
  seedFollowStateFromList,
  writeOptimisticFollowState,
  writeServerFollowState,
  followGraphChangedSince,
  writeConfirmedFollowState,
} from '../followState';
import { toggleRegistry } from '../mutationRegistry';

/**
 * The shared follow-state entry is the client's single answer to "does the
 * viewer follow this account?". Everything here is a property the old,
 * scattered version got wrong at least once.
 */
describe('followState', () => {
  let qc;

  beforeEach(() => {
    qc = new QueryClient();
    toggleRegistry.clear('follow:ravi');
  });

  it('is tri-state — absent is not the same as false', () => {
    expect(readFollowState(qc, 'ravi')).toBeUndefined();

    writeServerFollowState(qc, 'ravi', false);
    expect(readFollowState(qc, 'ravi')).toBe(false);
  });

  it('treats usernames case-insensitively', () => {
    writeServerFollowState(qc, 'Ravi', true);
    expect(readFollowState(qc, 'rAvI')).toBe(true);
    expect(qc.getQueryData(followStateKey('RAVI'))).toBe(true);
  });

  it('ignores a non-boolean, so an absent API field cannot overwrite a known state', () => {
    writeServerFollowState(qc, 'ravi', true);

    // This is the exact regression: a list payload that has not been taught to
    // include `isFollowing` used to be read as `u.isFollowing || false` and
    // downgraded a followed account to "Follow".
    writeServerFollowState(qc, 'ravi', undefined);
    expect(readFollowState(qc, 'ravi')).toBe(true);
  });

  describe('seedFollowStateFromList', () => {
    it('takes the boolean rows and skips the rest', () => {
      seedFollowStateFromList(qc, [
        { username: 'ann', isFollowing: true },
        { username: 'bob', isFollowing: false },
        { username: 'cal' }, // no field — must not be recorded as "not following"
        null,
      ]);

      expect(readFollowState(qc, 'ann')).toBe(true);
      expect(readFollowState(qc, 'bob')).toBe(false);
      expect(readFollowState(qc, 'cal')).toBeUndefined();
    });

    it('does nothing with a non-array', () => {
      expect(() => seedFollowStateFromList(qc, undefined)).not.toThrow();
    });
  });

  describe('a click that is still in flight outranks a server payload', () => {
    it('declines the server write while a toggle for that account is pending', () => {
      writeServerFollowState(qc, 'ravi', false);

      // The viewer presses Follow. The intent is registered before the request
      // is even scheduled.
      toggleRegistry.register('follow:ravi', true);
      writeOptimisticFollowState(qc, 'ravi', true);

      // A response that was already on the wire lands, still saying "false".
      writeServerFollowState(qc, 'ravi', false);

      expect(readFollowState(qc, 'ravi')).toBe(true);
    });

    /**
     * This case used to assert the opposite -- that once the toggle settled,
     * any server write was accepted again. That is the bug, written down as a
     * contract.
     *
     * Settling ends the REQUEST; it does not make older readings valid. The
     * panel remounts when a profile is opened and replays its cached rows,
     * which were generated before the follow and still say `isFollowing:
     * false`. Under the old contract those replays landed, and the button
     * reverted. Verified live: one `true` from the mutation followed by four
     * `false` writes from the remount seeds, with no fetch in between.
     */
    it('still declines an untimestamped write after the toggle settles', () => {
      toggleRegistry.register('follow:ravi', true);
      writeOptimisticFollowState(qc, 'ravi', true);
      toggleRegistry.clear('follow:ravi');

      writeServerFollowState(qc, 'ravi', false);
      expect(readFollowState(qc, 'ravi')).toBe(true);
    });

    it('accepts a write that PROVES it is newer than the click', () => {
      toggleRegistry.register('follow:ravi', true);
      writeOptimisticFollowState(qc, 'ravi', true);
      toggleRegistry.clear('follow:ravi');

      // A genuinely fresh refetch -- e.g. the viewer unfollowed on another
      // device and this payload was generated after the local click.
      writeServerFollowState(qc, 'ravi', false, Date.now() + 1000);
      expect(readFollowState(qc, 'ravi')).toBe(false);
    });

    it('declines a payload generated BEFORE the click, even timestamped', () => {
      const staleAt = Date.now() - 60_000;
      toggleRegistry.register('follow:ravi', true);
      writeOptimisticFollowState(qc, 'ravi', true);
      toggleRegistry.clear('follow:ravi');

      writeServerFollowState(qc, 'ravi', false, staleAt);
      expect(readFollowState(qc, 'ravi')).toBe(true);
    });

    it('lets the follow/unfollow response itself win unconditionally', () => {
      writeOptimisticFollowState(qc, 'ravi', true);
      // The server's answer to the write the viewer just made.
      writeConfirmedFollowState(qc, 'ravi', false);
      expect(readFollowState(qc, 'ravi')).toBe(false);
    });

    it('leaves untouched accounts seedable, so first paint still works', () => {
      writeOptimisticFollowState(qc, 'ravi', true);
      // A different account the viewer has not acted on this session.
      writeServerFollowState(qc, 'meera', true);
      expect(readFollowState(qc, 'meera')).toBe(true);
    });
  });

  describe('followGraphChangedSince', () => {
    it('reports a local follow that happened after a given moment', () => {
      const before = Date.now();
      vi.useFakeTimers();
      vi.setSystemTime(before + 1000);

      expect(followGraphChangedSince(before)).toBe(false);
      writeOptimisticFollowState(qc, 'ravi', true);
      expect(followGraphChangedSince(before)).toBe(true);

      // A later sync — issued after the follow — is not stale.
      expect(followGraphChangedSince(Date.now() + 1)).toBe(false);
      vi.useRealTimers();
    });

    it('does not count merely reading state from a payload as a change', () => {
      vi.useFakeTimers();
      vi.setSystemTime(Date.now() + 5000);
      const since = Date.now();
      vi.setSystemTime(since + 1000);

      seedFollowStateFromList(qc, [{ username: 'zed', isFollowing: true }]);

      expect(followGraphChangedSince(since)).toBe(false);
      vi.useRealTimers();
    });
  });
});
