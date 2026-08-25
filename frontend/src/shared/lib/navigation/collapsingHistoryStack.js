/**
 * Collapsing history stack — a Back stack that deduplicates instead of growing.
 *
 * The stack this replaces was push-only: every navigation event appended an
 * entry, including a return to a page the user had just come from. Toggling
 * between two tabs a hundred times left a hundred entries, so escaping the
 * toggling took a hundred Back presses. The depth of the stack tracked how
 * *busy* the user had been rather than where they had been.
 *
 * The invariant here is the opposite one:
 *
 *   The number of Back presses needed to leave a stretch of switching depends
 *   only on how many DISTINCT pages were touched — never on how many switches
 *   happened.
 *
 * It falls out of two rules applied on every navigation:
 *
 *   1. Navigating to the page already on top is a no-op. Nothing is pushed.
 *   2. Navigating to a page that already exists deeper in the stack pops back
 *      down to it, discarding the detour above it, rather than pushing a
 *      second copy.
 *
 * Only a genuinely new destination pushes. A → B → C → D therefore still
 * costs three Back presses to unwind, one per page: collapsing triggers on
 * *return*, never on forward progress.
 *
 * This module is deliberately free of any router, DOM or platform API. It
 * decides *what should happen* and returns a plan; the caller performs it.
 * That is what lets one implementation drive the browser Back button, an
 * Android hardware key, an iOS swipe and a programmatic goBack() identically —
 * every trigger asks this stack, so no trigger can develop its own idea of
 * what Back means.
 *
 * @example
 *   const stack = createHistoryStack({ defaultRoute: '/home' });
 *   stack.navigate('/home');            // { action: 'push' }
 *   stack.navigate('/a');               // { action: 'push' }
 *   stack.navigate('/b');               // { action: 'push' }
 *   stack.navigate('/a');               // { action: 'collapse', steps: 1 }
 *   stack.keys();                       // ['/home', '/a']
 */

/**
 * Hard ceiling on retained entries. The stack is already bounded by the number
 * of distinct pages visited, but "distinct pages" is unbounded in an app with
 * per-id routes (every profile, every chat), so a session that walks forever
 * forward would still grow forever. Trimming the oldest entries costs only the
 * ability to collapse onto something the user visited hundreds of pages ago.
 */
export const DEFAULT_MAX_ENTRIES = 100;

/**
 * @typedef {Object} HistoryEntry
 * @property {string} key   Page identity. Two entries with the same key are
 *                          the same page as far as Back is concerned.
 * @property {*} [meta]     Caller-owned payload. The browser adapter stores
 *                          the history index here so it can translate a
 *                          collapse into a `go(-n)`.
 */

/**
 * @typedef {Object} NavigationPlan
 * @property {'none'|'collapse'|'push'} action
 * @property {string} key
 * @property {HistoryEntry} target      The entry the user ends up on.
 * @property {number} index             Its index in the stack.
 * @property {number} steps             Entries discarded (0 for none/push).
 * @property {HistoryEntry[]} discarded The entries that were dropped.
 */

/**
 * @typedef {Object} BackPlan
 * @property {'back'|'default'|'exit'} action
 * @property {HistoryEntry} [target]  Entry to render (action === 'back').
 * @property {number} [index]
 * @property {string} [key]           Route to go to (action === 'default').
 * @property {number} steps           Entries popped.
 * @property {HistoryEntry[]} popped
 */

/**
 * @param {Object} [options]
 * @param {string} [options.defaultRoute='/']  Where Back goes when the stack
 *   runs out. Requirement: Back on an empty stack is never undefined — it
 *   either exits (see `onExit`) or lands here.
 * @param {Function} [options.onExit]  Called instead of `defaultRoute` when the
 *   stack empties, for platforms where the app should close (Android root).
 * @param {number} [options.maxEntries=100]
 * @param {boolean} [options.collapseToggleSessions=false]  Stretch behaviour:
 *   treat an uninterrupted stretch of toggling between already-seen pages as
 *   ONE logical step, so a single Back leaves the whole stretch instead of one
 *   press per distinct page. Off by default because it is strictly stronger
 *   than the guarantee most callers expect (Home → A → B → A → B, Back → A).
 * @param {(key: string) => string} [options.keyOf]  Identity normaliser, e.g.
 *   to ignore a query string or map several URLs onto one logical screen.
 */
export function createHistoryStack(options = {}) {
  const {
    defaultRoute = '/',
    onExit = null,
    maxEntries = DEFAULT_MAX_ENTRIES,
    collapseToggleSessions = false,
    keyOf = (key) => key,
  } = options;

  /** @type {HistoryEntry[]} */
  let entries = [];

  /** Retained per-key state (scroll offset, form draft…). See setState. */
  const states = new Map();

  /**
   * The stretch of toggling currently in progress, or null.
   *
   * `anchor` is the index of the deepest entry the toggling has returned to;
   * `seen` is every page the stretch has touched. A push of a page NOT in
   * `seen` is genuine forward progress and ends the stretch — that is the
   * guard that keeps requirement "don't collapse forward progress" intact
   * while the stretch collapsing is enabled.
   *
   * @type {{ anchor: number, seen: Set<string> } | null}
   */
  let session = null;

  function normalise(key) {
    return keyOf(key);
  }

  function lastIndexOfKey(key) {
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      if (entries[i].key === key) return i;
    }
    return -1;
  }

  function containsKey(key) {
    return lastIndexOfKey(key) !== -1;
  }

  /**
   * Drop retained state for entries that just left the stack.
   *
   * State for a *discarded* detour is genuinely dead — the user cannot reach
   * that entry again with Back — so holding it would be a leak. State for
   * entries that survive the collapse is untouched, which is what makes a
   * collapse feel like stepping back rather than reloading.
   */
  function dropStates(discarded) {
    discarded.forEach((entry) => {
      if (!containsKey(entry.key)) states.delete(entry.key);
    });
  }

  function enforceMax() {
    if (!Number.isFinite(maxEntries) || maxEntries <= 0) return;
    while (entries.length > maxEntries) {
      const [dropped] = entries.splice(0, 1);
      if (!containsKey(dropped.key)) states.delete(dropped.key);
      if (session) {
        session.anchor -= 1;
        // The stretch's starting point fell off the bottom, so we can no
        // longer say where leaving it would land. Forget it rather than guess.
        if (session.anchor < 0) session = null;
      }
    }
  }

  /** A return to somewhere already visited: start or widen the toggle stretch. */
  function noteReturn(index, key, discarded) {
    if (!session) {
      session = { anchor: index, seen: new Set() };
    } else if (index < session.anchor) {
      session.anchor = index;
    }
    session.seen.add(key);
    discarded.forEach((entry) => session.seen.add(entry.key));
  }

  /** A push: new page ends the stretch, a familiar one continues it. */
  function noteForward(key) {
    if (!session) return;
    if (!session.seen.has(key)) {
      session = null;
      return;
    }
    session.seen.add(key);
  }

  function exitPlan(popped) {
    const base = { steps: popped.length, popped };
    return onExit
      ? { action: 'exit', ...base }
      : { action: 'default', key: defaultRoute, ...base };
  }

  /**
   * Index Back should land on, or -1 when the stack runs out.
   * Pure: `planBack` and `back` share it so a previewed Back and a performed
   * Back can never disagree.
   */
  function backTargetIndex() {
    if (entries.length === 0) return -1;
    let target = entries.length - 2;
    if (collapseToggleSessions && session && entries.length - 1 >= session.anchor) {
      target = Math.min(target, session.anchor - 1);
    }
    return target;
  }

  const api = {
    /**
     * The reference algorithm. Returns the plan; it has ALREADY been applied
     * to this stack, so the caller only has to make the platform match.
     *
     * @param {string} rawKey
     * @param {Object} [opts]
     * @param {*} [opts.meta] Payload for the entry, when one is created.
     * @returns {NavigationPlan}
     */
    navigate(rawKey, opts = {}) {
      const key = normalise(rawKey);
      const top = entries.length - 1;

      // 1. Already here. A true no-op: pushing would give the user a Back
      //    press that visibly does nothing.
      //    `meta` is deliberately NOT refreshed — the browser adapter needs
      //    the ORIGINAL entry's index to work out how far back to step.
      if (top >= 0 && entries[top].key === key) {
        return { action: 'none', key, target: entries[top], index: top, steps: 0, discarded: [] };
      }

      // 2. Seen it before: collapse the detour instead of duplicating it.
      const existing = lastIndexOfKey(key);
      if (existing !== -1) {
        const discarded = entries.slice(existing + 1);
        entries.length = existing + 1;
        noteReturn(existing, key, discarded);
        dropStates(discarded);
        return {
          action: 'collapse',
          key,
          target: entries[existing],
          index: existing,
          steps: discarded.length,
          discarded,
        };
      }

      // 3. Genuinely new destination — the only case that grows the stack.
      noteForward(key);
      const entry = { key, meta: opts.meta };
      entries.push(entry);
      enforceMax();
      return {
        action: 'push',
        key,
        target: entry,
        index: entries.length - 1,
        steps: 0,
        discarded: [],
      };
    },

    /**
     * What Back would do, without doing it. The browser adapter uses this: it
     * asks the browser to pop and lets the resulting history event drive the
     * stack, so the two can never drift apart.
     * @returns {BackPlan}
     */
    planBack() {
      if (entries.length === 0) return exitPlan([]);
      const index = backTargetIndex();
      const popped = entries.slice(index + 1);
      if (index < 0) return exitPlan(popped);
      return { action: 'back', target: entries[index], index, steps: popped.length, popped };
    },

    /**
     * Perform Back. Every trigger — hardware key, swipe, browser chrome, an
     * in-app button — must end up here, or they stop agreeing with each other.
     * @returns {BackPlan}
     */
    back() {
      const plan = api.planBack();
      if (plan.action === 'back') {
        entries.length = plan.index + 1;
      } else {
        entries = [];
      }
      dropStates(plan.popped);
      // Leaving by Back ends any toggling stretch: whatever the user does
      // next starts fresh from where they landed.
      session = null;
      if (plan.action === 'exit' && typeof onExit === 'function') onExit();
      return plan;
    },

    /**
     * Record an entry without applying the dedupe rules.
     *
     * For adapters reconciling with a stack they do not own (a restored tab, a
     * history index we have no record of). Prefer `navigate`.
     */
    record(rawKey, meta) {
      const key = normalise(rawKey);
      const entry = { key, meta };
      entries.push(entry);
      enforceMax();
      return entry;
    },

    /** Swap the top entry's identity in place — a `replace` navigation. */
    replaceTop(rawKey, meta) {
      const key = normalise(rawKey);
      if (entries.length === 0) return api.record(key, meta);
      const top = entries.length - 1;
      const previous = entries[top];
      entries[top] = { key, meta: meta === undefined ? previous.meta : meta };
      if (previous.key !== key && !containsKey(previous.key)) states.delete(previous.key);
      return entries[top];
    },

    /** Keep the longest leading run of entries satisfying `predicate`. */
    keepWhile(predicate) {
      let end = 0;
      while (end < entries.length && predicate(entries[end], end)) end += 1;
      if (end === entries.length) return [];
      const removed = entries.slice(end);
      entries.length = end;
      dropStates(removed);
      if (session && session.anchor > entries.length - 1) session = null;
      return removed;
    },

    /** Replace the whole stack, e.g. after a hard reset or a login boundary. */
    reset(keys = []) {
      entries = keys.map((key) => (typeof key === 'string' ? { key: normalise(key) } : { ...key, key: normalise(key.key) }));
      states.clear();
      session = null;
      enforceMax();
    },

    clear() {
      entries = [];
      states.clear();
      session = null;
    },

    /**
     * Per-entry state that must survive a collapse (scroll offset, a half
     * typed form). Keyed by page identity, so an entry discarded by a collapse
     * loses its state and a retained one keeps it.
     */
    setState(rawKey, value) {
      states.set(normalise(rawKey), value);
    },
    getState(rawKey) {
      return states.get(normalise(rawKey));
    },
    hasState(rawKey) {
      return states.has(normalise(rawKey));
    },

    indexOf(rawKey) {
      return lastIndexOfKey(normalise(rawKey));
    },
    contains(rawKey) {
      return containsKey(normalise(rawKey));
    },
    peek() {
      return entries.length ? entries[entries.length - 1] : null;
    },
    at(index) {
      return entries[index] ?? null;
    },
    get size() {
      return entries.length;
    },
    isEmpty() {
      return entries.length === 0;
    },
    keys() {
      return entries.map((entry) => entry.key);
    },
    entries() {
      return entries.map((entry) => ({ ...entry }));
    },
    get defaultRoute() {
      return defaultRoute;
    },

    /** Introspection for adapters and tests; never mutate the result. */
    debugSession() {
      return session ? { anchor: session.anchor, seen: [...session.seen] } : null;
    },
  };

  return api;
}

export default createHistoryStack;
