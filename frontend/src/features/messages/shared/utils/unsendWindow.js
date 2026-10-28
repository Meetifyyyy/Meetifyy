/**
 * Whether to OFFER unsend for a message. Cosmetic only: the server decides,
 * on its own clock, against the time it accepted the message (backend
 * messages/core/unsend-policy.ts). This just stops offering an action that
 * will be refused. A device whose clock is wrong may offer it a little early
 * or late; the server's answer is what happens either way.
 */
export const UNSEND_WINDOW_MS = 15 * 60 * 1000;

export function canOfferUnsend(msg, now = Date.now()) {
  const sentAt = Date.parse(msg?.createdAt || msg?.timestamp || '');
  // No server time on it (an unconfirmed message has no id to unsend anyway).
  if (!Number.isFinite(sentAt)) return true;
  return now - sentAt <= UNSEND_WINDOW_MS;
}

/** What to tell the person when the server refused an unsend. */
export function unsendErrorMessage(err) {
  const code = String(err?.code || '').toUpperCase();
  if (code === 'UNSEND_WINDOW_EXPIRED') return 'Messages can only be unsent within 15 minutes';
  if (code === 'NOT_A_MEMBER') return "You're no longer in this group";
  if (err instanceof Error && typeof err.status !== 'number') return "Couldn't unsend. Check your connection.";
  return "Couldn't unsend";
}
