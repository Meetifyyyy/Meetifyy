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
});
