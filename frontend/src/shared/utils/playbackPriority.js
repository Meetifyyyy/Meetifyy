/**
 * Who wins when two things want to play at once. See feedVideoRegistry.
 *
 * Kept apart from the registry so a consumer can name its priority without
 * importing the singleton (and so a test can replace the registry without also
 * losing these numbers).
 */
export const PLAYBACK_PRIORITY = Object.freeze({
  /** A video playing inline in the feed. */
  FEED: 0,
  /** A voice note the user started on purpose. */
  VOICE: 5,
  /** The fullscreen media viewer. */
  VIEWER: 10,
});
