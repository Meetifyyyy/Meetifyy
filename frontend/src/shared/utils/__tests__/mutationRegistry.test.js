import { describe, it, expect, beforeEach } from 'vitest';
import { toggleRegistry } from '../mutationRegistry';

describe('MutationRegistry Stress & Concurrency Tests', () => {
  beforeEach(() => {
    toggleRegistry.activeMutations.clear();
    toggleRegistry.latestIntents.clear();
  });

  it('should handle single registration and latest check', () => {
    const key = 'likePost:post-1';
    const id = toggleRegistry.register(key, true);

    expect(toggleRegistry.isLatest(key, id)).toBe(true);
    expect(toggleRegistry.getLatestIntent(key, false)).toBe(true);
  });

  it('should calculate next toggle intent correctly on rapid clicks (Closure Bug Fix)', () => {
    const key = 'likePost:post-1';
    const initialPropState = false;

    // Click 1: initial prop state false -> next intent true
    const next1 = toggleRegistry.getNextToggleIntent(key, initialPropState);
    expect(next1).toBe(true);
    const id1 = toggleRegistry.register(key, next1);

    // Click 2 (fired 5ms later before React re-renders, propState STILL false)
    const next2 = toggleRegistry.getNextToggleIntent(key, initialPropState);
    expect(next2).toBe(false); // Should correctly flip to false!
    const id2 = toggleRegistry.register(key, next2);

    // Click 3 (fired 5ms later, propState STILL false)
    const next3 = toggleRegistry.getNextToggleIntent(key, initialPropState);
    expect(next3).toBe(true); // Should correctly flip back to true!
    const id3 = toggleRegistry.register(key, next3);

    // Verify id1 and id2 are superseded, only id3 is latest
    expect(toggleRegistry.isLatest(key, id1)).toBe(false);
    expect(toggleRegistry.isLatest(key, id2)).toBe(false);
    expect(toggleRegistry.isLatest(key, id3)).toBe(true);
  });

  it('should handle 100+ rapid clicks stress test', () => {
    const key = 'follow:user-999';
    let propState = false;
    let lastId = null;

    for (let i = 0; i < 150; i++) {
      const nextIntent = toggleRegistry.getNextToggleIntent(key, propState);
      expect(nextIntent).toBe(i % 2 === 0 ? true : false);
      lastId = toggleRegistry.register(key, nextIntent);
    }

    // The 150th click should be false (even number index 0 is true, 1 is false... 149 is false)
    expect(toggleRegistry.getLatestIntent(key, false)).toBe(false);
    expect(toggleRegistry.isLatest(key, lastId)).toBe(true);
  });

  it('should safely clear registry entries on settled', () => {
    const key = 'joinCommunity:comm-42';
    const id = toggleRegistry.register(key, true);

    toggleRegistry.clearIfLatest(key, id);
    expect(toggleRegistry.isLatest(key, id)).toBe(false);
    expect(toggleRegistry.activeMutations.has(key)).toBe(false);
    expect(toggleRegistry.latestIntents.has(key)).toBe(false);
  });

  it('does not let a stranded intent hijack the first click (first-click bug)', () => {
    const key = 'joinActivity:act-1';

    // A mutation is registered but never settles — the request was aborted, or
    // the user navigated away mid-flight. The singleton outlives the unmount.
    toggleRegistry.register(key, true);
    toggleRegistry.activeMutations.delete(key); // request no longer in flight

    // Server truth: the user is NOT joined. The stranded intent must not win,
    // otherwise the UI renders "Joined" and the next click computes `!true`
    // => leave, which the server rejects as a no-op. That is the click that
    // "does nothing"; only the second click would then join.
    expect(toggleRegistry.getLatestIntent(key, false)).toBe(false);
    expect(toggleRegistry.getNextToggleIntent(key, false)).toBe(true);
  });

  it('only the still-current mutation may clear the entry', () => {
    const key = 'joinActivity:act-2';
    const stale = toggleRegistry.register(key, true);
    const current = toggleRegistry.register(key, false);

    // A superseded request settling must not wipe the newer intent.
    expect(toggleRegistry.clearIfLatest(key, stale)).toBe(false);
    expect(toggleRegistry.getLatestIntent(key, true)).toBe(false);

    expect(toggleRegistry.clearIfLatest(key, current)).toBe(true);
    expect(toggleRegistry.getLatestIntent(key, true)).toBe(true); // falls back to server state
  });
});
