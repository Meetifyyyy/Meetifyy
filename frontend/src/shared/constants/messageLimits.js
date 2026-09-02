/**
 * The longest message body the server will accept.
 *
 * Must match MAX_MESSAGE_TEXT_LENGTH in backend/src/messages/core/message-limits.ts.
 * The server is the enforcement; this exists so a person is stopped at the
 * composer with the count in front of them, rather than writing a long message
 * and losing it to a rejection at send time.
 *
 * Characters, not bytes, for the same reason the server counts characters: a
 * byte limit would cut a Hindi or emoji message far shorter than an English one
 * of the same visible length, and the number shown has to be the number
 * enforced.
 */
export const MAX_MESSAGE_TEXT_LENGTH = 5000;

/**
 * How close to the limit the counter starts showing.
 *
 * A counter that is always on is noise in a chat composer; one that only
 * appears when it is nearly relevant is information.
 */
export const MESSAGE_LENGTH_WARN_AT = MAX_MESSAGE_TEXT_LENGTH - 500;
