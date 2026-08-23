import { useGlobalSocketStore } from '@shared/stores/useGlobalSocketStore';

const ACK_TIMEOUT_MS = 10000;

/**
 * Instant Match transport.
 *
 * Rides the app's existing authenticated socket rather than opening a second
 * connection. That matters for more than efficiency: the shared socket lives
 * for the whole session and is already joined to the user's personal room, so
 * a match arrives whether the sheet is open, minimised, or closed. The old
 * per-sheet socket dropped the user out of matching the moment they minimised.
 *
 * On top of the raw socket this adds three guarantees the UI depends on:
 *
 *  1. Emits never disappear. An action issued while the socket is down is held
 *     and flushed on connect, so tapping "Find Match" during a reconnect
 *     cannot leave someone searching for a match the server never heard about.
 *  2. Every action resolves. Each emit waits for the server ack, or times out,
 *     and reports the outcome — failures surface as errors, not silence.
 *  3. Listeners are additive and independently removable, so React re-renders
 *     and StrictMode's double-invoke cannot tear down a live subscription.
 */
class MatchSocketClient {
  constructor() {
    this.listeners = new Map();   // event -> Set<fn>
    this.dispatchers = new Map(); // event -> stable socket handler
    this.pending = [];            // actions buffered until the socket is ready
    this.socket = null;
    this.storeUnsub = null;
    this.refCount = 0;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Begins tracking the shared socket. Reference-counted so multiple mounted
   * consumers can hold it without any one of them detaching it for the others.
   * Returns a release function.
   */
  acquire() {
    this.refCount += 1;
    if (this.refCount === 1) this._start();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.refCount = Math.max(0, this.refCount - 1);
      if (this.refCount === 0) this._stop();
    };
  }

  _start() {
    this._attach(useGlobalSocketStore.getState().socket);
    // SocketManager replaces the socket instance on sign-in and token refresh;
    // re-attach so subscriptions survive it.
    this.storeUnsub = useGlobalSocketStore.subscribe((state) => {
      if (state.socket !== this.socket) this._attach(state.socket);
    });
  }

  _stop() {
    this.storeUnsub?.();
    this.storeUnsub = null;
    this._detach();
    this.pending.forEach(({ fail }) => fail('Connection closed'));
    this.pending = [];
  }

  _attach(socket) {
    this._detach();
    this.socket = socket || null;
    if (!this.socket) return;

    for (const event of this.listeners.keys()) {
      this.socket.on(event, this._dispatcher(event));
    }
    this.socket.on('connect', this._onConnect);
    this.socket.on('disconnect', this._onDisconnect);

    if (this.socket.connected) this._onConnect();
  }

  _detach() {
    if (!this.socket) return;
    for (const event of this.listeners.keys()) {
      this.socket.off(event, this._dispatcher(event));
    }
    this.socket.off('connect', this._onConnect);
    this.socket.off('disconnect', this._onDisconnect);
    this.socket = null;
  }

  _onConnect = () => {
    this._flush();
    this._emitLocal('transport:status', { connected: true });
  };

  _onDisconnect = (reason) => {
    this._emitLocal('transport:status', { connected: false, reason });
  };

  get connected() {
    return Boolean(this.socket?.connected);
  }

  // ── Subscriptions ──────────────────────────────────────────────────────────

  /** Subscribe to a server event. Returns an unsubscribe function. */
  on(event, callback) {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
      // One socket handler per event fans out to every subscriber, so adding
      // or removing a subscriber never touches the socket itself.
      this.socket?.on(event, this._dispatcher(event));
    }
    set.add(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    const set = this.listeners.get(event);
    if (!set) return;
    if (callback) set.delete(callback);
    else set.clear();
  }

  _dispatcher(event) {
    if (!this.dispatchers.has(event)) {
      this.dispatchers.set(event, (payload) => {
        const set = this.listeners.get(event);
        if (!set) return;
        // Copy first — a handler may unsubscribe itself mid-dispatch.
        for (const fn of [...set]) {
          try {
            fn(payload);
          } catch (err) {
            console.error(`[instant-match] listener for "${event}" threw`, err);
          }
        }
      });
    }
    return this.dispatchers.get(event);
  }

  _emitLocal(event, payload) {
    this._dispatcher(event)(payload);
  }

  // ── Requests ───────────────────────────────────────────────────────────────

  /**
   * Emits with an ack and resolves to `{ ok, error }`. Never rejects for an
   * expected failure: callers get a value to render rather than an exception
   * to chase, so no Instant Match path can end in an unhandled rejection.
   */
  request(event, payload = {}) {
    return new Promise((resolve) => {
      const send = () => {
        let settled = false;
        const finish = (result) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(result);
        };
        const timer = setTimeout(
          () => finish({ ok: false, error: 'The server is taking too long to respond', timeout: true }),
          ACK_TIMEOUT_MS,
        );

        try {
          this.socket.emit(event, payload, (ack) => {
            if (ack?.status === 'ok') finish({ ok: true, data: ack });
            else finish({ ok: false, error: ack?.error || 'Something went wrong', code: ack?.code });
          });
        } catch (err) {
          finish({ ok: false, error: err?.message || 'Could not reach the server' });
        }
      };

      if (this.connected) {
        send();
        return;
      }

      // Held until the socket connects. If the transport is torn down first
      // the entry fails loudly instead of hanging forever.
      this.pending.push({
        run: send,
        fail: (error) => resolve({ ok: false, error }),
      });
    });
  }

  _flush() {
    const queued = this.pending;
    this.pending = [];
    queued.forEach(({ run }) => run());
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  joinQueue(request) {
    return this.request('queue:join', request);
  }

  cancelQueue() {
    return this.request('queue:cancel', {});
  }

  respondToMatch(matchId, action) {
    return this.request('match:respond', { matchId, action });
  }

  /** Asks the server to restore this user's authoritative match state. */
  sync() {
    return this.request('queue:sync', {});
  }

  /**
   * The authoritative state of this user's Instant Match chat.
   *
   * Called on mount, on reconnect, and on tab focus. Realtime events are an
   * optimisation on top of this — never the only path to it — so a user who
   * was offline when the other person left still learns about it.
   */
  chatState() {
    return this.request('instant_match:chat_state', {});
  }

  /** Leave the current match. Safe to call twice: the server claims the
   *  transition once and answers both callers with the resulting state. */
  leaveChat(matchId) {
    return this.request('instant_match:leave', matchId ? { matchId } : {});
  }
}

export default new MatchSocketClient();
