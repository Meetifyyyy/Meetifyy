/**
 * feedVideoRegistry.js
 *
 * Global singleton that enforces a single-active-video policy across
 * the entire application. Every <video> that wants to play must call
 * `requestPlay(id)` first; the registry pauses any currently active
 * lower-priority source before granting permission.
 *
 * Priority levels
 *   10  – MediaViewer (active media viewer video)
 *    5  – VoiceMessagePlayer (a voice note the user started deliberately)
 *    0  – InlineVideoPlayer (feed card inline video)
 *
 * Despite the name this is element-agnostic: it needs only `paused` and
 * `pause()`, so an <audio> registers exactly like a <video>.
 */

export { PLAYBACK_PRIORITY } from './playbackPriority';

class FeedVideoRegistry {
  constructor() {
    /** @type {Map<string, {el: HTMLVideoElement, priority: number}>} */
    this._entries = new Map();
    /** @type {string|null} Currently active (playing) video id */
    this._activeId = null;
  }

  /**
   * Register a video element.
   * @param {string} id
   * @param {HTMLVideoElement} el
   * @param {number} priority Higher wins; default = 0.
   * @returns {() => void} Deregister function — call on unmount.
   */
  register(id, el, priority = 0) {
    this._entries.set(id, { el, priority });
    return () => this.deregister(id);
  }

  deregister(id) {
    if (this._activeId === id) this._activeId = null;
    this._entries.delete(id);
  }

  /**
   * Request permission to play.
   *
   * An active source of lower or equal priority is paused and the caller is
   * granted. An active source of HIGHER priority is left alone and the caller is
   * refused: a feed video scrolling into view behind the open viewer must not
   * stop the video being watched in it. A refused caller that is already playing
   * is paused here, so ignoring the result cannot leave two sources audible;
   * callers that have not started yet should simply not call `play()`.
   *
   * An "active" entry whose element is already paused (it stopped without
   * telling us) never blocks anyone.
   * @param {string} id
   * @returns {boolean} true if the caller may proceed with play()
   */
  requestPlay(id) {
    const entry = this._entries.get(id);
    if (!entry) return true; // Not registered — allow unconditionally.

    const current = this._activeId && this._entries.get(this._activeId);
    if (current && this._activeId !== id) {
      const currentIsPlaying = !current.el.paused;
      if (currentIsPlaying && current.priority > entry.priority) {
        try {
          if (!entry.el.paused) entry.el.pause();
        } catch (_) {}
        return false;
      }
      try {
        if (currentIsPlaying) current.el.pause();
      } catch (_) {}
    }

    this._activeId = id;
    return true;
  }

  /**
   * Notify that a video was paused voluntarily.
   * @param {string} id
   */
  notifyPause(id) {
    if (this._activeId === id) this._activeId = null;
  }

  /**
   * Pause every registered video below the given priority.
   * @param {number} [belowPriority=Infinity]
   */
  pauseAll(belowPriority = Infinity) {
    for (const [id, { el, priority }] of this._entries) {
      if (priority < belowPriority) {
        try { if (!el.paused) el.pause(); } catch (_) {}
        if (this._activeId === id) this._activeId = null;
      }
    }
  }

  get activeId() { return this._activeId; }
}

export const feedVideoRegistry = new FeedVideoRegistry();
