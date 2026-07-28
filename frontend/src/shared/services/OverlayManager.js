// Centralized Overlay Manager & Back-Button Interceptor
// Manages modals, drawers, bottom sheets, and lightboxes so browser/hardware Back button closes active overlays instead of changing page routes.

class OverlayManager {
  constructor() {
    this.stack = []; // Array of { id, onClose, options }
    this.isHandlingPopstate = false;
    this.listenerInitialized = false;
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

  handlePopstate = (event) => {
    if (this.stack.length > 0) {
      this.isHandlingPopstate = true;
      const topOverlay = this.stack.pop();
      try {
        if (typeof topOverlay.onClose === 'function') {
          topOverlay.onClose();
        }
      } catch (e) {
        console.error('Error closing overlay on popstate:', e);
      } finally {
        setTimeout(() => {
          this.isHandlingPopstate = false;
        }, 50);
      }
    }
  };

  /**
   * Register an active overlay (modal, drawer, lightbox).
   * Pushes a synthetic history state if enableBackDismiss is true (default true).
   */
  open(id, onClose, options = { pushHistoryState: true }) {
    this.init();

    // Prevent duplicate entries for same overlay ID
    this.closeSilently(id);

    const entry = { id, onClose, options };
    this.stack.push(entry);

    if (options.pushHistoryState && typeof window !== 'undefined') {
      const currentState = window.history.state || {};
      window.history.pushState({ ...currentState, __overlayId: id }, '', window.location.href);
    }

    return () => this.close(id);
  }

  /**
   * Close an overlay programmatically (e.g. X button or backdrop click).
   * If a synthetic history entry was pushed, pop it cleanly.
   */
  close(id) {
    const index = this.stack.findIndex((item) => item.id === id);
    if (index === -1) return;

    const [removed] = this.stack.splice(index, 1);

    if (removed.options?.pushHistoryState && !this.isHandlingPopstate && typeof window !== 'undefined') {
      if (window.history.state && window.history.state.__overlayId === id) {
        window.history.back();
      }
    }
  }

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
    if (this.stack.length > 0) {
      const top = this.stack[this.stack.length - 1];
      this.close(top.id);
      return true;
    }
    return false;
  }
}

export const overlayManager = new OverlayManager();
