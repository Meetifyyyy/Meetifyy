/**
 * Deciding whether a failed Resend send is safe to retry through Brevo.
 *
 * Falling back on every error is wrong in two different directions, and both
 * cost real messages:
 *
 *   - Some failures mean the message WAS probably accepted. A socket that times
 *     out after the request left tells us nothing about what Resend did with
 *     it. Sending it again through Brevo is how one signup produces two
 *     verification emails.
 *   - Some failures will fail identically on Brevo. A malformed recipient is
 *     not a Resend problem, and retrying it just spends the relay's quota to
 *     produce the same rejection a second later.
 *
 * So a failure is classified before anything is retried.
 */
export type ResendFailureKind =
  /** Resend answered and declined. The message was not sent; Brevo may work. */
  | 'not-sent'
  /** The message is bad. Brevo would reject it too; do not spend a send on it. */
  | 'permanent'
  /** We do not know whether it was sent. Never duplicate on this. */
  | 'ambiguous';

/** Resend's own error names for "you are over a limit". */
const QUOTA_NAMES = new Set([
  'rate_limit_exceeded',
  'daily_quota_exceeded',
  'monthly_quota_exceeded',
  'concurrency_limit_exceeded',
]);

/** Errors about the message itself, which any provider would reject. */
const PERMANENT_NAMES = new Set([
  'validation_error',
  'invalid_parameter',
  'invalid_from_address',
  'invalid_to_address',
  'missing_required_field',
]);

/**
 * A structured rejection from Resend, built by the caller when the API answered
 * with an error body rather than by failing at the transport.
 */
export class ResendRejection extends Error {
  constructor(
    message: string,
    readonly errorName: string,
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'ResendRejection';
  }
}

/**
 * What we know about a failed send.
 *
 * The default for anything unrecognised is `ambiguous`, deliberately. Guessing
 * "not sent" on an unfamiliar error is what produces duplicates, and a
 * duplicate verification email is worse than a delayed one — the job is retried
 * either way.
 */
export function classifyResendFailure(error: unknown): ResendFailureKind {
  if (error instanceof ResendRejection) {
    const name = (error.errorName || '').toLowerCase();
    const status = error.statusCode ?? 0;

    if (QUOTA_NAMES.has(name) || status === 429) return 'not-sent';
    if (PERMANENT_NAMES.has(name) || (status >= 400 && status < 500 && status !== 429)) {
      // A 4xx that is not a rate limit is a complaint about the request. Resend
      // did not send it, but neither would Brevo, so there is nothing to gain.
      return 'permanent';
    }
    // A 5xx means Resend accepted the request and then failed to process it.
    // It reported the failure itself, so it did not send.
    if (status >= 500) return 'not-sent';
    return 'not-sent';
  }

  const err = error as { name?: string; message?: string; code?: string };
  const name = String(err?.name || '');
  const code = String(err?.code || '');
  const message = String(err?.message || '').toLowerCase();

  /*
   * Connection-level failures that happen BEFORE anything is sent. The request
   * never left, so nothing can have been accepted.
   */
  if (
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    message.includes('getaddrinfo') ||
    message.includes('econnrefused')
  ) {
    return 'not-sent';
  }

  /*
   * A timeout or an aborted socket. The request may have been fully delivered
   * and processed with only the response lost. This is the case the whole
   * classifier exists for.
   */
  if (
    name === 'AbortError' ||
    name === 'TimeoutError' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNRESET' ||
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('socket hang up')
  ) {
    return 'ambiguous';
  }

  return 'ambiguous';
}
