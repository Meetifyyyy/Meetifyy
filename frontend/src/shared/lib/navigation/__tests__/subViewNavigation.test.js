import { describe, expect, it } from 'vitest';
import { createBrowserHistoryMirror } from '../browserHistoryMirror';

/**
 * Leaving a URL-backed sub-view for a page you have already seen.
 *
 * The profile page opens its Followers/Following list by pushing a history
 * entry (`?tab=followers`). Tapping a row then navigates to that person's
 * profile — and if their profile was already somewhere in this session's
 * history, a PUSH is not what happens.
 *
 * SmartBackTracker reconciles every arrival against the mirror, and a push onto
 * a page already in the stack is COLLAPSED: the mirror answers with a step that
 * walks history back onto the existing entry. `sync` reasons that this is
 * invisible because it lands on the same URL, but the route still remounts and
 * refetches, so what the user sees is the profile opening and instantly being
 * yanked away. That was the reported "clicking a follower does nothing, it just
 * flickers".
 *
 * These drive the real mirror rather than a description of it, because the
 * behaviour being pinned belongs to the mirror and not to the modal.
 */
function trace(steps) {
  const mirror = createBrowserHistoryMirror({ defaultRoute: '/home' });
  const results = [];
  let idx = 0;
  for (const [key, navType] of steps) {
    if (navType === 'PUSH') idx += 1;
    const out = mirror.sync({ idx, key, navType });
    results.push({ key, navType, step: out?.go ?? null });
  }
  return results;
}

const last = (steps) => trace(steps).at(-1);

describe('pushing to a profile already in the stack', () => {
  it('is collapsed into a backward step, which is the flicker', () => {
    // Somya's profile was opened earlier, then we went to our own profile and
    // opened its follower list. Tapping Somya pushes her profile again.
    const result = last([
      ['/home', 'PUSH'],
      ['/profile/somya', 'PUSH'],
      ['/profile/sarthak', 'PUSH'],
      ['/profile/sarthak?tab=followers', 'PUSH'],
      ['/profile/somya', 'PUSH'],
    ]);
    expect(result.step).not.toBeNull();
    expect(result.step).toBeLessThan(0);
  });

  it('does not collapse when the profile is genuinely new', () => {
    // Which is why the bug looked intermittent: it only bit for people you had
    // already visited in the same session.
    const result = last([
      ['/home', 'PUSH'],
      ['/profile/sarthak', 'PUSH'],
      ['/profile/sarthak?tab=followers', 'PUSH'],
      ['/profile/newperson', 'PUSH'],
    ]);
    expect(result.step).toBeNull();
  });
});

describe('replacing the sub-view entry instead', () => {
  /**
   * The fix in UserListModal. A replace consumes the list's own entry rather
   * than stacking on top of it, and `sync`'s REPLACE branch never emits a step,
   * so there is nothing to fight the navigation.
   */
  it('never steps, even for a profile already in the stack', () => {
    const result = last([
      ['/home', 'PUSH'],
      ['/profile/somya', 'PUSH'],
      ['/profile/sarthak', 'PUSH'],
      ['/profile/sarthak?tab=followers', 'PUSH'],
      ['/profile/somya', 'REPLACE'],
    ]);
    expect(result.step).toBeNull();
  });

  it('never steps for a new profile either', () => {
    const result = last([
      ['/home', 'PUSH'],
      ['/profile/sarthak', 'PUSH'],
      ['/profile/sarthak?tab=followers', 'PUSH'],
      ['/profile/newperson', 'REPLACE'],
    ]);
    expect(result.step).toBeNull();
  });

  it('holds when the same row is tapped repeatedly', () => {
    // Each tap replaces the entry it created, so the stack cannot grow a run of
    // duplicates and no tap ever collapses onto the previous one.
    const results = trace([
      ['/home', 'PUSH'],
      ['/profile/sarthak', 'PUSH'],
      ['/profile/sarthak?tab=followers', 'PUSH'],
      ['/profile/somya', 'REPLACE'],
      ['/profile/somya', 'REPLACE'],
      ['/profile/somya', 'REPLACE'],
    ]);
    expect(results.filter((r) => r.step !== null)).toEqual([]);
  });

  it('leaves the profile beneath the list reachable by Back', () => {
    // The list entry is consumed, not the profile that owns it, so Back from
    // the person you picked still returns to the profile you were reading.
    const mirror = createBrowserHistoryMirror({ defaultRoute: '/home' });
    let idx = 0;
    for (const [key, navType] of [
      ['/home', 'PUSH'],
      ['/profile/sarthak', 'PUSH'],
      ['/profile/sarthak?tab=followers', 'PUSH'],
      ['/profile/somya', 'REPLACE'],
    ]) {
      if (navType === 'PUSH') idx += 1;
      mirror.sync({ idx, key, navType });
    }
    const plan = mirror.planBack({ idx, fallbackRoute: '/home' });
    expect(plan.go).toBe(-1);
  });
});
