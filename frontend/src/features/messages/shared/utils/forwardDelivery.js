/**
 * Client ids for forwarding one message to several chats, safely retryable.
 * Used by the share sheet's forward mode (in-chat Forward and the media viewer).
 *
 * The forward entry points once looped over the selected recipients, recorded the failures and threw, leaving
 * the whole selection in place. A retry therefore re-sent to the recipients that
 * had already succeeded, and because every send minted a fresh client id the
 * backend (which de-duplicates on sender + conversation + clientMessageId)
 * could not recognise the repeat.
 *
 * The fix is a per-operation id: every recipient gets a client id derived from
 * (operation, recipient), so re-sending to someone who already got it is
 * recognised by the server instead of delivering twice.
 */

// Backend limit for clientMessageId is 128 characters (message-limits.ts).
const MAX_CLIENT_ID_LENGTH = 128;

/** A new id for one logical "forward this to these people" action. */
export function newForwardOperationId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 24);
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  throw new Error('A secure random source is required to forward a message');
}

/** Stable client id for one recipient within one forward operation. */
export function forwardClientId(operationId, recipientId) {
  return `fwd_${operationId}_${recipientId}`.slice(0, MAX_CLIENT_ID_LENGTH);
}

/** The shared things a forward carries on: everything but a group invite. */
const FORWARDABLE_SHARES = new Set(['postShare', 'profileShare', 'communityShare', 'activityShare', 'confessionShare']);

/**
 * What a forwarded message re-sends as its attachment. A share is nothing but
 * its `inviteData` (its text is empty), so a forward that left it out sent an
 * empty message. A group invite is not passed on: it grants entry to a chat
 * and was meant for the people it was sent to.
 */
export function forwardedInviteData(msg) {
  const invite = msg?.inviteData || msg?.payload?.inviteData;
  return invite && typeof invite === 'object' && FORWARDABLE_SHARES.has(invite.type) ? invite : null;
}
