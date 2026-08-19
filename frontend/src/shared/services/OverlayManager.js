// Centralized Overlay Manager & Back-Button Interceptor
//
// Manages modals, drawers, bottom sheets and lightboxes so that browser and
// hardware Back close the active overlay instead of changing route.
//
// History is pushed *through React Router*, never through raw
// `window.history.pushState`. A raw push reuses the router's `idx` stamp, which
// leaves two entries claiming the same index — the router then miscounts every
// subsequent `navigate(-n)` and the history stack drifts out of sync with the
// UI. `setNavigator` is called once from the router root (see
// OverlayHistoryBridge) to hand this singleton the router's navigate function.

class OverlayManager {
  constructor() {
    this.stack = []; // [{ id, onClose, options, url }]
    this.isHandlingPopstate = false;
    this.listenerInitialized = false;
    this.navigator = null;
    // Number of popstate events we caused ourselves and must not interpret as
    // a user Back press.
    this.pendingSelfPops = 0;
  }

  /**
   * Called once from the router root. Without it, overlays still work — they
   * just don't participate in history (Back closes the page, not the overlay).
   */
  setNavigator(navigate) {
    this.navigator = navigate;
    this.init();
  }

  init() {
    if (this.listenerInitialized || typeof window === 'undefined') return;
    this.listenerInitialized = true;
    window.addEventListener('popstate', this.handlePopstate);
  }

  destroy() {
    if (typeof window === 'undefined') return;
    window.removeEventListener('popstate', this.handlePopstate);
    this.listenerInitialized = false;
  }

  currentUrl() {
    if (typeof window === 'undefined') return '';
    return window.location.pathname + window.location.search;
  }

  handlePopstate = () => {
    // A pop we triggered ourselves in close() — already accounted for.
    if (this.pendingSelfPops > 0) {
      this.pendingSelfPops -= 1;
      return;
    }
    if (this.stack.length === 0) return;

    const url = this.currentUrl();
    const top = this.stack[this.stack.length - 1];

    this.isHandlingPopstate = true;
    try {
      if (top.url && top.url !== url) {
        // The pop left the page the overlays belong to entirely (a multi-step
        // Back, or a restored session). Tear all of them down at once so no
        // overlay survives onto an unrelated route.
        const dying = this.stack.splice(0, this.stack.length).reverse();
        dying.forEach((entry) => this.safeClose(entry));
      } else {
        this.stack.pop();
        this.safeClose(top);
      }
    } finally {
      this.isHandlingPopstate = false;
    }
  };

  safeClose(entry) {
    try {
      if (typeof entry.onClose === 'function') entry.onClose();
    } catch (e) {
      console.error('Error closing overlay:', e);
    }
  }

  /**
   * Register an active overlay. Returns a disposer.
   * Pushes a history entry (so Back dismisses it) unless
   * `options.pushHistoryState` is false.
   */
  open(id, onClose, options = { pushHistoryState: true }) {
    this.init();

    // Never let the same overlay id occupy two slots.
    this.closeSilently(id);

    const url = this.currentUrl();
    const pushHistoryState = options.pushHistoryState !== false && !!this.navigator;
    const entry = { id, onClose, options: { ...options, pushHistoryState }, url };
    this.stack.push(entry);

    if (pushHistoryState) {
      // Same URL, new entry: the route is unchanged, only the overlay layer is.
      this.navigator(url, { state: { __overlayId: id }, preventScrollReset: true });
    }

    return () => this.close(id);
  }

  /**
   * Close an overlay programmatically (X button, backdrop click, Escape).
   * Pops the synthetic history entry it pushed so the stack stays balanced.
   */
  close(id) {
    const index = this.stack.findIndex((item) => item.id === id);
    if (index === -1) return;

    // Closing an overlay that isn't on top would strand the entries above it,
    // so close everything down to and including it, top-first.
    const removed = this.stack.splice(index, this.stack.length - index).reverse();

    removed.forEach((entry) => this.safeClose(entry));

    if (this.isHandlingPopstate) return;

    const popCount = removed.filter((e) => e.options?.pushHistoryState).length;
    if (popCount > 0 && this.navigator) {
      // A single go(-n) fires exactly one popstate, however many entries it
      // spans — so we expect one self-pop, not `popCount` of them.
      this.pendingSelfPops += 1;
      this.navigator(-popCount);
    }
  }

  /** Remove an overlay from tracking without firing its onClose or touching history. */
  closeSilently(id) {
    const index = this.stack.findIndex((item) => item.id === id);
    if (index !== -1) {
      this.stack.splice(index, 1);
    }
  }

  hasOpenOverlays() {
    return this.stack.length > 0;
  }

  closeTop() {
    if (this.stack.length === 0) return false;
    this.close(this.stack[this.stack.length - 1].id);
    return true;
  }
}

export const overlayManager = new OverlayManager();
