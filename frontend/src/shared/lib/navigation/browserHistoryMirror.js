import { createHistoryStack } from './collapsingHistoryStack';

/**
 * Browser adapter for the collapsing history stack.
 *
 * The web has a history stack of its own that we do not own and cannot edit:
 * we can only push onto it, or step back through it. So the collapsing stack
 * is kept as a *mirror* of the browser's — every retained entry remembers the
 * browser index it lives at (`meta.idx`, the monotonic stamp React Router puts
 * on each entry it creates) — and a collapse is performed as a real
 * `go(-n)`.
 *
 * Doing it that way rather than simulating a stack in memory is what makes the
 * browser Back button, the Android hardware key and the iOS swipe behave
 * identically to an in-app Back: all four move the same real stack, and since
 * the mirror never contains two entries for the same page, one press is always
 * exactly one page.
 *
 * The mirror also self-corrects. It is fed every location change with the
 * index and type the router reports, so a navigation it never saw (a raw
 * `useNavigate`, a `<Link>`, a restored tab) is reconciled on arrival: a push
 * that lands on a page already in the mirror is walked straight back to the
 * existing entry. Call sites therefore cannot opt out of the collapsing rule
 * by not using the hook.
 *
 * Overlay entries (a modal pushing an entry so Back dismisses it) are
 * transparent here: they are never mirrored, because they are not pages. They
 * still occupy a browser index, which is why every distance is computed from
 * the recorded `idx` values instead of from the mirror's own length.
 */

/** A history index we can actually do arithmetic with. */
export function isUsableIdx(idx) {
  // `typeof NaN === 'number'`, and a negative or fractional index is equally
  // unusable — it would produce a nonsense `go(-n)` distance.
  return Number.isSafeInteger(idx) && idx >= 0;
}

/**
 * @param {Object} [options] Passed through to `createHistoryStack`, plus:
 * @param {ReturnType<typeof createHistoryStack>} [options.stack] Existing stack
 *   to adopt (used when rehydrating from sessionStorage).
 */
export function createBrowserHistoryMirror(options = {}) {
  const { stack = createHistoryStack(options), collapseToggleSessions = false } = options;

  /**
   * The index this app session started at. Entries at or below it belong to
   * whatever the user was doing before the app loaded — another site, a fresh
   * tab — so Back must never simulate its way into them.
   */
  let originIdx = null;

  /**
   * Last (idx, key, navType) actually applied. React StrictMode double-invokes
   * effects, and applying a collapse twice would pop twice — the user would
   * lose a page they never asked to leave.
   */
  let lastApplied = null;

  /**
   * A step WE asked for is about to arrive as a history event. It must not be
   * read as a user pressing Back: the pop that finishes a collapse is the tail
   * end of a forward navigation, and treating it as a Back press would let the
   * toggle-stretch rule fire on a move the user never made.
   */
  let selfStep = false;

  function floor() {
    return originIdx ?? 0;
  }

  const mirror = {
    stack,

    /**
     * Feed the mirror a location change.
     *
     * @param {Object} change
     * @param {number|null} change.idx  `history.state.idx`, or null if absent.
     * @param {string} change.key       Page identity (path + query).
     * @param {'PUSH'|'POP'|'REPLACE'} change.navType
     * @param {boolean} [change.isOverlay] Entry pushed by an overlay, not a page.
     * @returns {{ go: number } | null} A browser step to perform, or null.
     */
    sync({ idx, key, navType, isOverlay = false }) {
      if (!key) return null;

      // No router-managed index (a very old browser, or an entry pushed
      // outside the router). We cannot do distance arithmetic, so run the
      // stack logically and never emit a step: worst case Back is dumber, not
      // wrong.
      if (!isUsableIdx(idx)) {
        if (navType === 'REPLACE') stack.replaceTop(key);
        else if (navType === 'PUSH') stack.navigate(key);
        return null;
      }

      if (originIdx === null || idx < originIdx) {
        // Either the first entry of this session, or the user went back past
        // it (possible after a tab restore). Re-anchor so we never claim
        // entries we know nothing about.
        originIdx = idx;
      }

      if (
        lastApplied &&
        lastApplied.idx === idx &&
        lastApplied.key === key &&
        lastApplied.navType === navType
      ) {
        return null;
      }
      lastApplied = { idx, key, navType };

      // An overlay's entry is not a page. Mirroring it would make the modal
      // look like a duplicate of the page underneath and invite a collapse
      // onto an entry that only exists to be popped.
      if (isOverlay) return null;

      if (navType === 'REPLACE') {
        const top = stack.peek();
        if (top && top.meta?.idx === idx) stack.replaceTop(key, { idx });
        else {
          stack.keepWhile((entry) => entry.meta?.idx < idx);
          stack.record(key, { idx });
        }
        return null;
      }

      if (navType === 'POP') {
        const wasSelfStep = selfStep;
        selfStep = false;
        // The browser moved us; the mirror follows rather than argues.
        stack.keepWhile((entry) => entry.meta?.idx <= idx);
        if (stack.peek()?.meta?.idx !== idx) stack.record(key, { idx });
        if (wasSelfStep) return null;
        return mirror.step(mirror.continueToggleExit(idx));
      }

      // PUSH. The browser has already discarded everything forward of `idx`.
      stack.keepWhile((entry) => entry.meta?.idx < idx);

      const plan = stack.navigate(key, { meta: { idx } });
      if (plan.action === 'push') return null;

      // 'none' (re-entering the page we were on) or 'collapse' (re-entering a
      // page deeper in the stack): the browser pushed an entry the stack
      // refused. Give it back by stepping onto the entry that already exists,
      // which is the same URL, so nothing visibly re-renders — the user just
      // ends up on the entry they originally walked, with its scroll position.
      const targetIdx = plan.target?.meta?.idx;
      if (!isUsableIdx(targetIdx) || targetIdx >= idx || targetIdx < floor()) return null;
      return mirror.step({ go: targetIdx - idx });
    },

    /**
     * Mark a step as ours before handing it to the caller, so the history
     * event it produces is not mistaken for a user Back press.
     */
    step(request) {
      if (request?.go) selfStep = true;
      return request;
    },

    /**
     * Stretch behaviour: after a Back lands inside a toggling stretch, keep
     * going until we are out of it, so one press leaves the whole stretch.
     * Off unless `collapseToggleSessions` is set — see createHistoryStack.
     */
    continueToggleExit(idx) {
      if (!collapseToggleSessions) return null;
      const session = stack.debugSession();
      if (!session || session.anchor <= 0) return null;
      const top = stack.size - 1;
      if (top < session.anchor) return null;
      const target = stack.at(session.anchor - 1);
      const targetIdx = target?.meta?.idx;
      if (!isUsableIdx(targetIdx) || targetIdx >= idx || targetIdx < floor()) return null;
      return { go: targetIdx - idx };
    },

    /**
     * Steps needed to reach an existing entry for `key`, or null when there
     * isn't one below us — i.e. what a forward navigation to an
     * already-visited page should do INSTEAD of pushing.
     *
     * Used by `smartNavigate` to pre-empt the push rather than undo it after
     * the fact. The mirror collapses immediately here, because the step is a
     * navigation we are performing, not one we are reacting to; the POP it
     * produces then finds the stack already in its final shape.
     *
     * @returns {{ go: number } | null}
     */
    planCollapse({ idx, key }) {
      if (!key || !isUsableIdx(idx)) return null;
      const index = stack.indexOf(key);
      if (index === -1) return null;
      const entryIdx = stack.at(index)?.meta?.idx;
      if (!isUsableIdx(entryIdx) || entryIdx >= idx || entryIdx < floor()) return null;
      stack.navigate(key);
      return mirror.step({ go: entryIdx - idx });
    },

    /**
     * What Back should do from `idx`, expressed as a browser step.
     *
     * The mirror is NOT mutated: the step is performed on the real history and
     * the resulting POP comes back through `sync`, which is the single place
     * the stack is allowed to shrink. One writer, no drift.
     *
     * @returns {{ go: number } | { route: string } | { exit: true }}
     */
    planBack({ idx, fallbackRoute } = {}) {
      const plan = stack.planBack();
      if (plan.action === 'back' && isUsableIdx(idx)) {
        const targetIdx = plan.target?.meta?.idx;
        if (isUsableIdx(targetIdx) && targetIdx < idx && targetIdx >= floor()) {
          return { go: targetIdx - idx, target: plan.target };
        }
      }
      if (plan.action === 'exit') return { exit: true };
      return { route: fallbackRoute || plan.key || stack.defaultRoute };
    },

    /** True when there is a page of ours behind the current one. */
    canGoBack(idx) {
      if (stack.size <= 1) return false;
      if (!isUsableIdx(idx)) return false;
      return idx > floor();
    },

    getOrigin() {
      return originIdx;
    },

    /** Serialisable snapshot for sessionStorage (a reload keeps the stack). */
    snapshot() {
      return { entries: stack.entries(), originIdx };
    },

    hydrate(snapshot) {
      if (!snapshot || !Array.isArray(snapshot.entries)) return;
      const restored = snapshot.entries.filter(
        (entry) => entry && typeof entry.key === 'string' && isUsableIdx(entry.meta?.idx),
      );
      stack.reset(restored);
      originIdx = isUsableIdx(snapshot.originIdx) ? snapshot.originIdx : null;
      lastApplied = null;
      selfStep = false;
    },

    reset() {
      stack.clear();
      originIdx = null;
      lastApplied = null;
      selfStep = false;
    },
  };

  return mirror;
}

export default createBrowserHistoryMirror;
