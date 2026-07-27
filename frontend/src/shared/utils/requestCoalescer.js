/**
 * RequestCoalescer manages debounced network emissions and AbortControllers
 * per entity key. Modeled after Instagram/X request pipeline architecture:
 * 1. Flips Optimistic UI state instantly on EVERY click (0ms delay).
 * 2. Debounces the network emission by 250ms.
 * 3. Aborts any in-flight request for the same entity key via AbortController.
 * 4. Transmits ONLY 1 final request to the backend per rapid clicking session.
 */

class RequestCoalescer {
  constructor() {
    this.timers = new Map();       // entityKey -> setTimeout ID
    this.controllers = new Map();  // entityKey -> AbortController
  }

  /**
   * Schedule a debounced network emission with AbortController signal.
   * @param {string} key - Unique entity key (e.g., 'likePost:123')
   * @param {Function} fn - Callback receiving (signal) to trigger network request
   * @param {number} [debounceMs=250] - Debounce delay in milliseconds
   */
  schedule(key, fn, debounceMs = 250) {
    if (!key) {
      fn(null);
      return;
    }

    // 1. Cancel pending timer for intermediate clicks
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
      this.timers.delete(key);
    }

    // 2. Abort any previous in-flight request
    if (this.controllers.has(key)) {
      try {
        this.controllers.get(key).abort();
      } catch (e) {
        // ignore abort error
      }
      this.controllers.delete(key);
    }

    // 3. Schedule the final request emission
    const timerId = setTimeout(() => {
      this.timers.delete(key);
      const controller = new AbortController();
      this.controllers.set(key, controller);
      
      fn(controller.signal);
    }, debounceMs);

    this.timers.set(key, timerId);
  }

  /**
   * Clear controller tracking after request completes.
   */
  clearController(key) {
    this.controllers.delete(key);
  }
}

export const coalescer = new RequestCoalescer();
