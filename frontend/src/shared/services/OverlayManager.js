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

  navigate(to, options) {
    if (typeof this.navigator === 'function') {
      return this.navigator(to, options);
    }
    if (typeof window !== 'undefined') {
      window.location.assign(typeof to === 'string' ? to : (to?.pathname || '/'));
    }
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

        // A multi-step overlay can consume the Back instead of closing: its
        // handler steps to the previous step and reports that it is still on
        // screen. The entry then goes back on the stack and a fresh history
        // entry is pushed, so the next Back is intercepted the same way and
        // the user walks out of the flow one step at a time rather than
        // losing the whole thing (or the page) on the first press.
        const stillOpen = this.safeClose(top, true);
        if (stillOpen) {
          this.stack.push(top);
          if (top.options?.pushHistoryState && this.navigator) {
            this.navigator(top.url, { state: { __overlayId: top.id }, preventScrollReset: true });
          }
        }
      }
    } finally {
      this.isHandlingPopstate = false;
    }
  };

  /**
   * Run an entry's handler. Returns true when the handler reports the overlay
   * is still open (a multi-step flow that stepped back rather than closing).
   * A throwing handler is treated as closed — leaving a broken overlay
   * registered would swallow every future Back press.
   */
  safeClose(entry, viaBack = false) {
    try {
      if (typeof entry.onClose === 'function') return entry.onClose(viaBack) === true;
    } catch (e) {
      console.error('Error closing overlay:', e);
    }
    return false;
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

      // Verify the entry actually landed, and record the truth on the entry.
      //
      // Everything downstream assumes an overlay that claims `pushHistoryState`
      // has its own entry to give back and its own Back press to absorb. When
      // the push silently does not happen, that assumption inverts the
      // behaviour: the next Back pops whatever was underneath instead — the
      // panel or page hosting the overlay — and handlePopstate then sees the
      // URL has changed and tears every overlay down. One press closes the
      // modal AND the page it was opened from, which is precisely the report
      // dialog / chat details report.
      //
      // An entry that cannot be confirmed is marked non-backable, so it is
      // dismissed by Escape and the backdrop like any other overlay but never
      // claims a history entry it does not own.
      if (this.currentHistoryOverlayId() !== id) {
        entry.options.pushHistoryState = false;
      }
    }

    // Unmount must not re-fire onClose — see dispose().
    return () => this.dispose(id);
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
    this.rebalance(removed);
  }

  /**
   * Which overlay, if any, pushed the history entry the browser is sitting on.
   *
   * `open()` stamps every entry it pushes with `state: { __overlayId }`, and
   * React Router nests user state under `.usr`. Reading it back is the only
   * way to *prove* the top of the history stack is ours rather than assume it.
   */
  /** Seam: the browser's current history state. Overridable in tests. */
  readHistoryState() {
    if (typeof window === 'undefined') return null;
    return window.history.state;
  }

  currentHistoryOverlayId() {
    const state = this.readHistoryState();
    return state?.usr?.__overlayId ?? state?.__overlayId ?? null;
  }

  /**
   * Give back the history entries the removed overlays pushed — but only when
   * we can PROVE the browser is still sitting on one of them.
   *
   * This used to pop whenever the arithmetic said it should, and the
   * arithmetic is only as good as its assumptions about mount order, batched
   * unmounts and concurrent navigation. Every time one of those assumptions
   * was wrong the user was thrown to a previous page — cropping a community
   * avatar or a profile picture unmounted the cropper mid-flow and the stray
   * `go(-1)` took the page with it.
   *
   * The stamped id turns an assumption into a check. If the entry on top is
   * not one of the entries being removed, we leave history completely alone.
   * The cost of not popping is one Back press that appears to do nothing,
   * because the entry shares its URL with the page beneath it. The cost of
   * popping wrongly is the user losing the page they were working on. Those
   * are not close, so this errs hard in one direction.
   */
  rebalance(removed) {
    if (!this.navigator) return;

    const here = this.currentUrl();
    const poppable = removed.filter(
      (e) => e.options?.pushHistoryState && e.url === here,
    );
    if (poppable.length === 0) return;

    // Consecutive pushes, removed together: the top entry must be one of them.
    const topId = this.currentHistoryOverlayId();
    if (!topId || !poppable.some((e) => e.id === topId)) return;

    // A single go(-n) fires exactly one popstate, however many entries it
    // spans — so we expect one self-pop, not `poppable.length` of them.
    this.pendingSelfPops += 1;
    this.navigator(-poppable.length);
  }

  /**
   * Unregister an unmounting overlay: drop it from the stack and rebalance
   * history, but do NOT fire onClose.
   *
   * This is the disposer `open()` hands back. It must stay distinct from
   * `close()`: by the time React runs an effect cleanup the component is
   * already going away, so calling its onClose would be a re-entrant request
   * to close something that no longer exists. Under StrictMode's
   * mount→cleanup→mount double-invoke that turned every overlay into a
   * single-frame flash — it opened, its own cleanup told the parent to close
   * it, and it unmounted before painting.
   */
  dispose(id) {
    const index = this.stack.findIndex((item) => item.id === id);
    if (index === -1) return;

    const removed = this.stack.splice(index, this.stack.length - index).reverse();

    if (this.isHandlingPopstate) return;
    this.rebalance(removed);
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
