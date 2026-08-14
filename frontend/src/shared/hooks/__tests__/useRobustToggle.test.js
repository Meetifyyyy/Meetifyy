import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toggleRegistry } from '../../utils/mutationRegistry';

describe('useRobustToggle Hook Logic & Out-of-Order Swallowing', () => {
  beforeEach(() => {
    toggleRegistry.activeMutations.clear();
    toggleRegistry.latestIntents.clear();
  });

  it('should allow success callback for the latest mutation ID', () => {
    const key = 'likePost:100';
    const id = toggleRegistry.register(key, true);

    const onSuccess = vi.fn();
    const isLatest = toggleRegistry.isLatest(key, id);

    if (isLatest) {
      onSuccess();
    }

    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('should swallow stale error callbacks when superseded by a newer mutation', () => {
    const key = 'likePost:100';
    
    // Request 1
    const id1 = toggleRegistry.register(key, true);
    
    // Request 2 fires before Request 1 resolves
    const id2 = toggleRegistry.register(key, false);

    const rollback1 = vi.fn();
    const toastError1 = vi.fn();

    // Request 1 fails after Request 2 was sent
    if (toggleRegistry.isLatest(key, id1)) {
      rollback1();
      toastError1();
    }

    // Assert Request 1 callbacks were completely swallowed!
    expect(rollback1).not.toHaveBeenCalled();
    expect(toastError1).not.toHaveBeenCalled();

    // Request 2 succeeds
    const onSuccess2 = vi.fn();
    if (toggleRegistry.isLatest(key, id2)) {
      onSuccess2();
    }

    expect(onSuccess2).toHaveBeenCalledTimes(1);
  });
});
