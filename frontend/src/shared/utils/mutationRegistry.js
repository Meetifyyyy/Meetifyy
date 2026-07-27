/**
 * A lightweight registry to track the latest active mutation ID and synchronous intent 
 * for a given entity. This completely eliminates both:
 * 1. Out-of-order response overwrites / stale error flickers.
 * 2. The React closure race condition where rapid double-clicks read un-rendered props.
 */

class MutationRegistry {
  constructor() {
    this.activeMutations = new Map(); // entityKey -> mutationId
    this.latestIntents = new Map();   // entityKey -> boolean
  }

  /**
   * Register a new mutation intent.
   * @param {string} entityKey - Unique identifier for the entity (e.g., 'likePost:123')
   * @param {boolean} [intentState] - The intended state resulting from this click (e.g. true for liked)
   * @returns {string} A unique mutation ID for this specific request
   */
  register(entityKey, intentState) {
    if (!entityKey) return null;
    
    const mutationId = Date.now().toString() + Math.random().toString(36).substring(2, 9);
    this.activeMutations.set(entityKey, mutationId);
    if (intentState !== undefined) {
      this.latestIntents.set(entityKey, intentState);
    }
    return mutationId;
  }

  /**
   * Returns the current pending intent if an active rapid toggle is happening,
   * otherwise returns the fallbackState passed from React props/cache.
   */
  getLatestIntent(entityKey, fallbackState) {
    if (entityKey && this.latestIntents.has(entityKey)) {
      return this.latestIntents.get(entityKey);
    }
    return fallbackState;
  }

  /**
   * Calculates the next target state for a toggle action by looking up the latest
   * active intent (if any) rather than relying solely on React's current prop render.
   */
  getNextToggleIntent(entityKey, currentPropState) {
    const currentIntent = this.getLatestIntent(entityKey, currentPropState);
    return !currentIntent;
  }

  /**
   * Check if a given mutation ID is the latest active mutation for the entity.
   */
  isLatest(entityKey, mutationId) {
    if (!entityKey || !mutationId) return true;
    return this.activeMutations.get(entityKey) === mutationId;
  }

  /**
   * Remove tracking entries if this mutation is still the latest upon settling.
   */
  clearIfLatest(entityKey, mutationId) {
    if (this.isLatest(entityKey, mutationId)) {
      this.activeMutations.delete(entityKey);
      this.latestIntents.delete(entityKey);
    }
  }
}

export const toggleRegistry = new MutationRegistry();
