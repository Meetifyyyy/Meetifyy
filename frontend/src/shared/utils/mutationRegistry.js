/**
 * A lightweight registry to track the latest active mutation ID and synchronous intent
 * for a given entity. This eliminates both:
 * 1. Out-of-order response overwrites / stale error flickers.
 * 2. The React closure race condition where rapid double-clicks read un-rendered props.
 *
 * IMPORTANT — why intents are strictly bounded:
 * This is a module-level singleton, so its Maps outlive component unmounts and route
 * changes. A pending intent that never gets cleared (an aborted request, a user who
 * navigates away mid-flight) would otherwise keep overriding the authoritative server
 * state forever. The UI would then render the stale intent, and the next click would
 * compute its target as `!staleIntent` — which can equal the state the server is
 * already in, making that click a silent no-op. That is the "first click does nothing,
 * second click works" bug.
 *
 * So a stored intent is only trusted while (a) its mutation is still active and
 * (b) it is recent. Otherwise callers fall back to server/cache state.
 */

// A toggle request that hasn't settled within this window is treated as abandoned.
const STALE_INTENT_MS = 15_000;

class MutationRegistry {
  constructor() {
    this.activeMutations = new Map(); // entityKey -> mutationId
    this.latestIntents = new Map();   // entityKey -> { value: boolean, ts: number }
  }

  /**
   * Register a new mutation intent.
   * @returns {string} A unique mutation ID — pass it back to clearIfLatest so only the
   *                   mutation that is still current can clear the entry.
   */
  register(entityKey, intentState) {
    if (!entityKey) return null;

    const mutationId = Date.now().toString() + Math.random().toString(36).substring(2, 9);
    this.activeMutations.set(entityKey, mutationId);
    if (intentState !== undefined) {
      this.latestIntents.set(entityKey, { value: intentState, ts: Date.now() });
    }
    return mutationId;
  }

  /**
   * Returns the pending intent only while it is genuinely in flight and fresh;
   * otherwise the caller's server/cache state wins.
   */
  getLatestIntent(entityKey, fallbackState) {
    if (!entityKey) return fallbackState;
    if (!this.activeMutations.has(entityKey)) return fallbackState;

    const entry = this.latestIntents.get(entityKey);
    if (!entry) return fallbackState;

    if (Date.now() - entry.ts > STALE_INTENT_MS) {
      this.clear(entityKey);
      return fallbackState;
    }
    return entry.value;
  }

  /**
   * Calculates the next target state for a toggle action by looking up the latest
   * active intent (if any) rather than relying solely on React's current prop render.
   */
  getNextToggleIntent(entityKey, currentPropState) {
    return !this.getLatestIntent(entityKey, currentPropState);
  }

  /** True when a mutation for this entity is still in flight. */
  isPending(entityKey) {
    if (!entityKey || !this.activeMutations.has(entityKey)) return false;
    const entry = this.latestIntents.get(entityKey);
    if (entry && Date.now() - entry.ts > STALE_INTENT_MS) {
      this.clear(entityKey);
      return false;
    }
    return true;
  }

  /** Check if a given mutation ID is the latest active mutation for the entity. */
  isLatest(entityKey, mutationId) {
    if (!entityKey || !mutationId) return false;
    return this.activeMutations.get(entityKey) === mutationId;
  }

  /** Remove tracking entries only if this exact mutation is still the latest. */
  clearIfLatest(entityKey, mutationId) {
    if (this.isLatest(entityKey, mutationId)) {
      this.clear(entityKey);
      return true;
    }
    return false;
  }

  /** Unconditionally drop tracking for an entity. */
  clear(entityKey) {
    this.activeMutations.delete(entityKey);
    this.latestIntents.delete(entityKey);
  }
}

export const toggleRegistry = new MutationRegistry();
