/**
 * Why a message was not sent, in words the person can act on.
 *
 * The bubble used to say "Not delivered" whatever happened, so being removed
 * from a group, an expired sign-in and a dropped connection all looked alike,
 * and all offered the same retry. The server now says why it refused (a
 * socket ack's `errorCode`, a REST error's `code`), and a failure that never
 * reached the server is told apart by having no HTTP status at all.
 *
 * `retryable` is false for a refusal that a retry cannot change. Those keep
 * the message and its text in the bubble, but offer no "Tap to retry".
 */
import { NOT_A_MEMBER } from './groupMembership';

const REASONS = {
  network: { label: 'Not sent · Check your connection', retryable: true },
  'rate-limited': { label: 'Not sent · Too many messages, try again shortly', retryable: true },
  auth: { label: 'Not sent · Sign in again to send', retryable: true },
  'not-member': { label: "Not sent · You're no longer in this group", retryable: false },
  unavailable: { label: 'Not sent · This account is no longer available', retryable: false },
  verification: { label: 'Not sent · Verify your account to send messages', retryable: false },
  refused: { label: "Not sent · You can't send messages here", retryable: false },
  unknown: { label: 'Not sent', retryable: true },
};

const codeOf = (failure) => {
  if (!failure || typeof failure !== 'object') return '';
  const code = failure.errorCode || failure.code || failure.data?.code || '';
  return typeof code === 'string' ? code.toUpperCase() : '';
};

/** The reason key for an outbox failure (see outbox.js `onFailed`). */
export function sendFailureReason(failure) {
  const code = codeOf(failure);
  if (code === NOT_A_MEMBER) return 'not-member';
  if (code === 'RECIPIENT_UNAVAILABLE') return 'unavailable';
  if (code === 'VERIFICATION_REQUIRED') return 'verification';
  if (code === 'RATE_LIMITED') return 'rate-limited';
  const status = typeof failure?.status === 'number' ? failure.status : undefined;
  if (status === 401) return 'auth';
  if (status === 429) return 'rate-limited';
  if (status === 403 || code === 'REJECTED') return 'refused';
  // Never reached the server: an Error with no status (fetch failed, timed out).
  if (failure instanceof Error && status === undefined) return 'network';
  return 'unknown';
}

/** What the bubble says, and whether it offers a retry, for a reason key. */
export function describeSendFailure(reason) {
  return REASONS[reason] || REASONS.unknown;
}
