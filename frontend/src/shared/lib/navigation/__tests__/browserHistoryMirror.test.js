import { describe, it, expect } from 'vitest';
import { createBrowserHistoryMirror } from '../browserHistoryMirror';

/**
 * A stand-in for the browser's history stack + SmartBackTracker.
 *
 * It models the two things that make the web hard here: entries are stamped
 * with a monotonic index we can only move through in steps, and a push
 * discards everything forward of the current entry. Every landing is fed to
 * the mirror exactly as the tracker feeds it, and any step the mirror asks for
 * is performed — so these tests exercise the real reconciliation loop, not a
 * paraphrase of it.
 */
function createFakeBrowser(mirror) {
  const entries = [];
  let idx = -1;
  let pushCount = 0;

  function land(navType, depth = 0) {
    if (depth > 20) throw new Error('mirror asked for steps forever — reconciliation loop');
    const entry = entries[idx];
    const step = mirror.sync({ idx, key: entry.key, navType, isOverlay: entry.overlay });
    if (step?.go) {
      idx += step.go;
      land('POP', depth + 1);
    }
  }

  return {
    push(key, { overlay = false } = {}) {
      entries.length = idx + 1; // a push discards the forward entries
      entries.push({ key, overlay });
      idx += 1;
      pushCount += 1;
      land('PUSH');
      return this;
    },
    replace(key) {
      entries[idx] = { key, overlay: false };
      land('REPLACE');
      return this;
    },
    go(delta) {
      const next = Math.min(entries.length - 1, Math.max(0, idx + delta));
      if (next === idx) return this;
      idx = next;
      land('POP');
      return this;
    },
    /** The browser Back button / Android key / iOS swipe: one raw step. */
    hardwareBack() {
      return this.go(-1);
    },
    /** An in-app Back button: asks the mirror what Back means, then does it. */
    appBack(fallbackRoute = '/home') {
      const plan = mirror.planBack({ idx, fallbackRoute });
      if (plan.go) {
        this.go(plan.go);
        return { via: 'history' };
      }
      if (plan.exit) return { via: 'exit' };
      this.replace(plan.route);
      return { via: 'route', route: plan.route };
    },
    get current() {
      return entries[idx]?.key ?? null;
    },
    get idx() {
      return idx;
    },
    get depth() {
      return entries.length;
    },
    get pushes() {
      return pushCount;
    },
  };
}

function setup(options = {}) {
  const mirror = createBrowserHistoryMirror({ defaultRoute: '/home', ...options });
  return { mirror, browser: createFakeBrowser(mirror) };
}

describe('browserHistoryMirror — acceptance tests against a real history stack', () => {
  it('toggle collapse: 100 switches leave a three-entry stack and two Back presses', () => {
    const { mirror, browser } = setup();
    browser.push('/home').push('/a');

    let deepest = mirror.stack.size;
    for (let i = 0; i <= 100; i += 1) {
      browser.push(i % 2 === 0 ? '/b' : '/a');
      deepest = Math.max(deepest, mirror.stack.size);
    }

    expect(browser.current).toBe('/b');
    expect(mirror.stack.keys()).toEqual(['/home', '/a', '/b']);
    expect(deepest).toBe(3);
    // The browser's own stack is bounded too — a collapse is a real step
    // back, so the next push overwrites the entry instead of stacking on it.
    expect(browser.depth).toBe(3);

    browser.appBack();
    expect(browser.current).toBe('/a');
    browser.appBack();
    expect(browser.current).toBe('/home');
  });

  it('no over-collapsing: three distinct pages still take three Back presses', () => {
    const { browser } = setup();
    browser.push('/home').push('/a').push('/b').push('/c');

    browser.appBack();
    expect(browser.current).toBe('/b');
    browser.appBack();
    expect(browser.current).toBe('/a');
    browser.appBack();
    expect(browser.current).toBe('/home');
  });

  it('mixed pattern: Home -> A -> B -> A -> C leaves Home -> A -> C', () => {
    const { mirror, browser } = setup();
    browser.push('/home').push('/a').push('/b').push('/a').push('/c');

    expect(mirror.stack.keys()).toEqual(['/home', '/a', '/c']);
    browser.appBack();
    expect(browser.current).toBe('/a');
    browser.appBack();
    expect(browser.current).toBe('/home');
  });
});

describe('browserHistoryMirror — every Back trigger behaves the same', () => {
  it('the hardware/browser Back button walks the collapsed stack, one page per press', () => {
    // Requirement: the Android key, the iOS swipe and the browser chrome all
    // produce a raw POP. They step one page because the stack physically
    // cannot hold two entries for the same page — nothing extra to skip.
    const { browser } = setup();
    browser.push('/home').push('/a');
    for (let i = 0; i <= 100; i += 1) browser.push(i % 2 === 0 ? '/b' : '/a');

    browser.hardwareBack();
    expect(browser.current).toBe('/a');
    browser.hardwareBack();
    expect(browser.current).toBe('/home');
  });

  it('a raw push that bypasses the hook is collapsed on arrival', () => {
    // A <Link> or a plain useNavigate() cannot opt out: the tracker reconciles
    // what actually landed, so the duplicate is given straight back.
    const { mirror, browser } = setup();
    browser.push('/home').push('/a').push('/b');

    browser.push('/a'); // raw push, no smart navigation involved

    expect(mirror.stack.keys()).toEqual(['/home', '/a']);
    expect(browser.current).toBe('/a');
    expect(browser.idx).toBe(1);
  });

  it('a push to the page we are already on is undone rather than stacked', () => {
    const { mirror, browser } = setup();
    browser.push('/home').push('/a');

    browser.push('/a');

    expect(mirror.stack.keys()).toEqual(['/home', '/a']);
    expect(browser.idx).toBe(1);
  });

  it('keeps the mirror aligned when the user goes forward again', () => {
    const { mirror, browser } = setup();
    browser.push('/home').push('/a').push('/b');
    browser.hardwareBack();
    expect(browser.current).toBe('/a');

    browser.go(1); // browser Forward

    expect(browser.current).toBe('/b');
    expect(mirror.stack.keys()).toEqual(['/home', '/a', '/b']);
  });
});

describe('browserHistoryMirror — planCollapse (pre-empting the push)', () => {
  it('reports the step onto an existing entry, and collapses the mirror with it', () => {
    // smartNavigate asks this BEFORE navigating, so the duplicate entry is
    // never created in the first place — no push to undo, no wasted render.
    const { mirror, browser } = setup();
    browser.push('/home').push('/a').push('/b');

    const collapse = mirror.planCollapse({ idx: browser.idx, key: '/a' });

    expect(collapse).toEqual({ go: -1 });
    expect(mirror.stack.keys()).toEqual(['/home', '/a']);
  });

  it('performing the step leaves browser and mirror agreeing', () => {
    const { mirror, browser } = setup();
    browser.push('/home').push('/a').push('/b').push('/c');

    browser.go(mirror.planCollapse({ idx: browser.idx, key: '/a' }).go);

    expect(browser.current).toBe('/a');
    expect(browser.idx).toBe(1);
    expect(mirror.stack.keys()).toEqual(['/home', '/a']);
  });

  it('returns null for a page not in the stack, so the caller pushes', () => {
    const { mirror, browser } = setup();
    browser.push('/home').push('/a');

    expect(mirror.planCollapse({ idx: browser.idx, key: '/never-seen' })).toBe(null);
    expect(mirror.stack.keys()).toEqual(['/home', '/a']);
  });

  it('refuses to step at or past the entry the session started on', () => {
    const { mirror } = setup();
    mirror.sync({ idx: 6, key: '/home', navType: 'PUSH' });

    expect(mirror.planCollapse({ idx: 6, key: '/home' })).toBe(null);
    expect(mirror.planCollapse({ idx: 6, key: '/something-older' })).toBe(null);
  });

  it('needs a usable history index to measure a step', () => {
    const { mirror, browser } = setup();
    browser.push('/home').push('/a');

    expect(mirror.planCollapse({ idx: null, key: '/home' })).toBe(null);
    expect(mirror.planCollapse({ idx: 1, key: '' })).toBe(null);
  });
});

describe('browserHistoryMirror — overlays', () => {
  it('does not mirror an overlay entry as a page', () => {
    // A modal pushes an entry sharing the page's URL purely so Back can eat
    // it. Mirroring it would make the modal look like a duplicate of the page
    // underneath and invite a collapse onto an entry that only exists to pop.
    const { mirror, browser } = setup();
    browser.push('/home').push('/a');

    browser.push('/a', { overlay: true });

    expect(mirror.stack.keys()).toEqual(['/home', '/a']);
    expect(browser.current).toBe('/a');
    expect(browser.idx).toBe(2); // the overlay entry is still there to pop

    browser.hardwareBack();
    expect(mirror.stack.keys()).toEqual(['/home', '/a']);
    expect(browser.idx).toBe(1);
  });

  it('measures a collapse in browser steps, so overlay entries in between are counted', () => {
    const { mirror, browser } = setup();
    browser.push('/home').push('/a').push('/b');
    browser.push('/b', { overlay: true });

    browser.push('/a');

    expect(browser.current).toBe('/a');
    expect(browser.idx).toBe(1);
    expect(mirror.stack.keys()).toEqual(['/home', '/a']);
  });
});

describe('browserHistoryMirror — Back with nothing of ours behind it', () => {
  it('goes to the fallback route on a deep link', () => {
    const { browser } = setup();
    browser.push('/crew/abc-123'); // arrived cold, no in-app history

    const result = browser.appBack('/crew');

    expect(result).toEqual({ via: 'route', route: '/crew' });
    expect(browser.current).toBe('/crew');
  });

  it('uses the configured default route when the caller names none', () => {
    const { mirror } = setup();
    mirror.sync({ idx: 4, key: '/settings', navType: 'PUSH' });

    expect(mirror.planBack({ idx: 4 })).toEqual({ route: '/home' });
  });

  it('never steps back past the entry the app session started on', () => {
    // idx 3 means three entries belong to whatever the user was doing before
    // the app loaded. Simulating Back into them would hand the user someone
    // else's page — that step belongs to the browser, not to us.
    const { mirror } = setup();
    mirror.sync({ idx: 3, key: '/home', navType: 'PUSH' });
    mirror.sync({ idx: 4, key: '/a', navType: 'PUSH' });

    expect(mirror.planBack({ idx: 4 }).go).toBe(-1);
    mirror.sync({ idx: 3, key: '/home', navType: 'POP' });
    expect(mirror.planBack({ idx: 3 })).toEqual({ route: '/home' });
    expect(mirror.canGoBack(3)).toBe(false);
  });

  it('exits when an exit handler is configured for the platform', () => {
    const { mirror } = setup({ onExit: () => {} });
    mirror.sync({ idx: 0, key: '/home', navType: 'PUSH' });

    expect(mirror.planBack({ idx: 0 })).toEqual({ exit: true });
  });
});

describe('browserHistoryMirror — resilience', () => {
  it('ignores a repeated sync for the same entry (React StrictMode double-invoke)', () => {
    // Applying a collapse twice would pop twice and cost the user a page they
    // never asked to leave.
    const { mirror } = setup();
    mirror.sync({ idx: 0, key: '/home', navType: 'PUSH' });
    mirror.sync({ idx: 1, key: '/a', navType: 'PUSH' });
    mirror.sync({ idx: 2, key: '/b', navType: 'PUSH' });

    const first = mirror.sync({ idx: 3, key: '/a', navType: 'PUSH' });
    const second = mirror.sync({ idx: 3, key: '/a', navType: 'PUSH' });

    expect(first).toEqual({ go: -2 });
    expect(second).toBe(null);
  });

  it('runs without history indices instead of doing something wrong', () => {
    // Very old browsers, or an entry pushed outside the router: no index to do
    // arithmetic with, so the stack still collapses logically but never asks
    // for a step it cannot measure.
    const { mirror } = setup();
    expect(mirror.sync({ idx: null, key: '/home', navType: 'PUSH' })).toBe(null);
    expect(mirror.sync({ idx: undefined, key: '/a', navType: 'PUSH' })).toBe(null);
    expect(mirror.sync({ idx: NaN, key: '/home', navType: 'PUSH' })).toBe(null);
    expect(mirror.stack.keys()).toEqual(['/home']);
  });

  it('replaces in place rather than growing the stack', () => {
    const { mirror, browser } = setup();
    browser.push('/home').push('/a');

    browser.replace('/a?tab=photos');

    expect(mirror.stack.keys()).toEqual(['/home', '/a?tab=photos']);
    expect(browser.depth).toBe(2);
  });

  it('survives a reload: the stack comes back from its snapshot', () => {
    const { mirror, browser } = setup();
    browser.push('/home').push('/a').push('/b');
    const snapshot = JSON.parse(JSON.stringify(mirror.snapshot()));

    const revived = createBrowserHistoryMirror({ defaultRoute: '/home' });
    revived.hydrate(snapshot);

    expect(revived.stack.keys()).toEqual(['/home', '/a', '/b']);
    expect(revived.planBack({ idx: 2 }).go).toBe(-1);
  });

  it('re-anchors instead of claiming entries it knows nothing about', () => {
    const { mirror } = setup();
    mirror.sync({ idx: 5, key: '/a', navType: 'PUSH' });
    expect(mirror.getOrigin()).toBe(5);

    // A restored tab drops us below where this session started.
    mirror.sync({ idx: 2, key: '/older', navType: 'POP' });

    expect(mirror.getOrigin()).toBe(2);
    expect(mirror.stack.keys()).toEqual(['/older']);
  });
});

describe('browserHistoryMirror — toggle-session collapsing (opt-in)', () => {
  it('leaves the whole stretch on one press, from any Back trigger', () => {
    const { mirror, browser } = setup({ collapseToggleSessions: true });
    browser.push('/home').push('/a');
    for (let i = 0; i <= 100; i += 1) browser.push(i % 2 === 0 ? '/b' : '/a');

    expect(mirror.stack.keys()).toEqual(['/home', '/a', '/b']);

    // Even the raw browser Back keeps going until it is out of the stretch,
    // so the hardware key and the in-app button do not disagree.
    browser.hardwareBack();
    expect(browser.current).toBe('/home');
  });

  it('still steps one page at a time through genuine forward progress', () => {
    const { browser } = setup({ collapseToggleSessions: true });
    browser.push('/home').push('/a').push('/b').push('/a').push('/c');

    browser.hardwareBack();
    expect(browser.current).toBe('/a');
    browser.hardwareBack();
    expect(browser.current).toBe('/home');
  });
});
