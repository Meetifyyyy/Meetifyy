import { describe, it, expect, vi } from 'vitest';
import { createHistoryStack } from '../collapsingHistoryStack';

/** Walk a route of pages through the stack, returning the plans in order. */
function walk(stack, keys) {
  return keys.map((key) => stack.navigate(key));
}

describe('collapsingHistoryStack — the collapsing rules', () => {
  it('does not push when navigating to the page already on top', () => {
    const stack = createHistoryStack();
    stack.navigate('/home');

    const plan = stack.navigate('/home');

    expect(plan.action).toBe('none');
    expect(stack.keys()).toEqual(['/home']);
  });

  it('ignores a same-page re-navigation however many times it happens', () => {
    const stack = createHistoryStack();
    walk(stack, ['/home', '/a', '/a', '/a', '/a']);
    expect(stack.keys()).toEqual(['/home', '/a']);
  });

  it('collapses back onto an entry already in the stack instead of duplicating it', () => {
    const stack = createHistoryStack();
    walk(stack, ['/home', '/a', '/b', '/c']);

    const plan = stack.navigate('/a');

    expect(plan.action).toBe('collapse');
    expect(plan.steps).toBe(2);
    expect(plan.discarded.map((e) => e.key)).toEqual(['/b', '/c']);
    expect(stack.keys()).toEqual(['/home', '/a']);
  });

  it('pushes a genuinely new destination', () => {
    const stack = createHistoryStack();
    const plans = walk(stack, ['/home', '/a', '/b', '/c']);
    expect(plans.map((p) => p.action)).toEqual(['push', 'push', 'push', 'push']);
    expect(stack.keys()).toEqual(['/home', '/a', '/b', '/c']);
  });
});

describe('collapsingHistoryStack — acceptance tests', () => {
  it('toggle collapse: 100 switches between two pages never exceed three entries', () => {
    // The bug this exists to kill: 100 toggles used to mean 100 Back presses.
    const stack = createHistoryStack({ defaultRoute: '/home' });
    walk(stack, ['/home', '/a']);

    let deepest = stack.size;
    // 101 switches so the stretch ends on B, as in the acceptance test.
    for (let i = 0; i <= 100; i += 1) {
      stack.navigate(i % 2 === 0 ? '/b' : '/a');
      deepest = Math.max(deepest, stack.size);
      // The invariant holds at every point, not just at the end.
      expect(stack.keys().length).toBeLessThanOrEqual(3);
    }

    expect(stack.peek().key).toBe('/b');
    expect(stack.keys()).toEqual(['/home', '/a', '/b']);
    expect(deepest).toBe(3);

    expect(stack.back().target.key).toBe('/a');
    expect(stack.back().target.key).toBe('/home');
  });

  it('no over-collapsing: three distinct pages still cost three Back presses', () => {
    const stack = createHistoryStack({ defaultRoute: '/home' });
    walk(stack, ['/home', '/a', '/b', '/c']);

    expect(stack.back().target.key).toBe('/b');
    expect(stack.back().target.key).toBe('/a');
    expect(stack.back().target.key).toBe('/home');
    expect(stack.keys()).toEqual(['/home']);
  });

  it('mixed pattern: the detour is dropped the moment the user returns', () => {
    // Home -> A -> B -> A -> C. B is discarded when A is revisited, so the
    // retained path is Home -> A -> C.
    const stack = createHistoryStack({ defaultRoute: '/home' });
    walk(stack, ['/home', '/a', '/b', '/a', '/c']);

    expect(stack.keys()).toEqual(['/home', '/a', '/c']);
    expect(stack.back().target.key).toBe('/a');
    expect(stack.back().target.key).toBe('/home');
  });
});

describe('collapsingHistoryStack — bounded growth', () => {
  it('is bounded by distinct pages, not by navigation events', () => {
    const stack = createHistoryStack();
    const pages = ['/home', '/a', '/b', '/c', '/d'];
    for (let i = 0; i < 500; i += 1) {
      stack.navigate(pages[i % pages.length]);
      expect(stack.size).toBeLessThanOrEqual(pages.length);
    }
    expect(new Set(stack.keys()).size).toBe(stack.size);
  });

  it('never holds two entries for the same page', () => {
    const stack = createHistoryStack();
    const pages = ['/w', '/x', '/y', '/z'];
    for (let i = 0; i < 200; i += 1) {
      stack.navigate(pages[Math.floor(Math.random() * pages.length)]);
      expect(new Set(stack.keys()).size).toBe(stack.size);
    }
  });

  it('trims the oldest entries past maxEntries so a forever-forward walk cannot grow forever', () => {
    const stack = createHistoryStack({ maxEntries: 10 });
    for (let i = 0; i < 100; i += 1) stack.navigate(`/page-${i}`);

    expect(stack.size).toBe(10);
    expect(stack.peek().key).toBe('/page-99');
    expect(stack.contains('/page-0')).toBe(false);
  });
});

describe('collapsingHistoryStack — Back on an empty stack', () => {
  it('goes to the named default route when no exit handler is configured', () => {
    const stack = createHistoryStack({ defaultRoute: '/home' });
    stack.navigate('/a');

    const plan = stack.back();

    expect(plan.action).toBe('default');
    expect(plan.key).toBe('/home');
    expect(stack.isEmpty()).toBe(true);
  });

  it('exits the app when an exit handler is configured', () => {
    const onExit = vi.fn();
    const stack = createHistoryStack({ onExit });
    stack.navigate('/a');

    expect(stack.back().action).toBe('exit');
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('stays defined when Back is pressed on an already-empty stack', () => {
    const stack = createHistoryStack({ defaultRoute: '/home' });
    const plan = stack.back();
    expect(plan.action).toBe('default');
    expect(plan.key).toBe('/home');
    expect(plan.steps).toBe(0);
  });

  it('previews Back without performing it', () => {
    const stack = createHistoryStack({ defaultRoute: '/home' });
    walk(stack, ['/home', '/a']);

    expect(stack.planBack().target.key).toBe('/home');
    expect(stack.keys()).toEqual(['/home', '/a']);
    expect(stack.back().target.key).toBe('/home');
    expect(stack.keys()).toEqual(['/home']);
  });
});

describe('collapsingHistoryStack — retained state', () => {
  it('keeps state for entries that survive a collapse and drops it for the rest', () => {
    const stack = createHistoryStack();
    walk(stack, ['/home', '/a', '/b']);
    stack.setState('/home', { scroll: 0 });
    stack.setState('/a', { scroll: 420, draft: 'half a sentence' });
    stack.setState('/b', { scroll: 90 });

    stack.navigate('/a');

    expect(stack.getState('/a')).toEqual({ scroll: 420, draft: 'half a sentence' });
    expect(stack.getState('/home')).toEqual({ scroll: 0 });
    // /b is unreachable now — holding its state would just be a leak.
    expect(stack.hasState('/b')).toBe(false);
  });

  it('drops state for entries popped by Back', () => {
    const stack = createHistoryStack();
    walk(stack, ['/home', '/a']);
    stack.setState('/a', { scroll: 10 });

    stack.back();

    expect(stack.hasState('/a')).toBe(false);
  });
});

describe('collapsingHistoryStack — stack maintenance helpers', () => {
  it('replaceTop swaps identity without changing depth', () => {
    const stack = createHistoryStack();
    walk(stack, ['/home', '/a']);

    stack.replaceTop('/a?tab=photos');

    expect(stack.keys()).toEqual(['/home', '/a?tab=photos']);
  });

  it('keepWhile truncates to a prefix', () => {
    const stack = createHistoryStack();
    walk(stack, ['/home', '/a', '/b', '/c']);

    const removed = stack.keepWhile((_entry, index) => index < 2);

    expect(stack.keys()).toEqual(['/home', '/a']);
    expect(removed.map((e) => e.key)).toEqual(['/b', '/c']);
  });

  it('normalises identity through keyOf, so query-only changes can be one page', () => {
    const stack = createHistoryStack({ keyOf: (key) => key.split('?')[0] });
    walk(stack, ['/home', '/a?tab=1', '/a?tab=2']);

    expect(stack.keys()).toEqual(['/home', '/a']);
  });

  it('reset adopts a stack wholesale, meta included', () => {
    const stack = createHistoryStack();
    stack.reset([{ key: '/home', meta: { idx: 0 } }, { key: '/a', meta: { idx: 1 } }]);

    expect(stack.keys()).toEqual(['/home', '/a']);
    expect(stack.at(1).meta).toEqual({ idx: 1 });
  });
});

describe('collapsingHistoryStack — toggle-session collapsing (opt-in)', () => {
  const options = { defaultRoute: '/home', collapseToggleSessions: true };

  it('leaves a whole toggling stretch in one Back press', () => {
    const stack = createHistoryStack(options);
    walk(stack, ['/home', '/a']);
    for (let i = 0; i <= 50; i += 1) stack.navigate(i % 2 === 0 ? '/b' : '/a');

    expect(stack.keys()).toEqual(['/home', '/a', '/b']);
    expect(stack.back().target.key).toBe('/home');
  });

  it('does NOT swallow genuine forward progress made after the toggling', () => {
    // The guard that keeps requirement 4 intact: entering a page the stretch
    // has never seen ends the stretch, so C -> A -> Home is still two presses.
    const stack = createHistoryStack(options);
    walk(stack, ['/home', '/a', '/b', '/a', '/c']);

    expect(stack.keys()).toEqual(['/home', '/a', '/c']);
    expect(stack.back().target.key).toBe('/a');
    expect(stack.back().target.key).toBe('/home');
  });

  it('never collapses a straight forward walk', () => {
    const stack = createHistoryStack(options);
    walk(stack, ['/home', '/a', '/b', '/c']);

    expect(stack.back().target.key).toBe('/b');
    expect(stack.back().target.key).toBe('/a');
    expect(stack.back().target.key).toBe('/home');
  });

  it('falls through to the default route when the stretch reaches the bottom', () => {
    // Home <-> A toggling: the screen "before the stretch" is behind the
    // bottom of the stack, which is exactly the empty-stack case.
    const stack = createHistoryStack(options);
    walk(stack, ['/home', '/a', '/home', '/a']);

    const plan = stack.back();

    expect(plan.action).toBe('default');
    expect(plan.key).toBe('/home');
  });

  it('is off by default: the same stretch costs one press per distinct page', () => {
    const stack = createHistoryStack({ defaultRoute: '/home' });
    walk(stack, ['/home', '/a', '/b', '/a', '/b']);

    expect(stack.back().target.key).toBe('/a');
    expect(stack.back().target.key).toBe('/home');
  });
});
