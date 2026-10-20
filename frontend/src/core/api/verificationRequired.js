/**
 * The API's "verify your account first" refusal, recognised.
 *
 * `@VerifiedOnly()` routes and the messaging/post/activity services answer an
 * unverified caller with HTTP 403 and `code: 'VERIFICATION_REQUIRED'`. Pure, so
 * the transport can use it and a test can run it without fetch.
 */
export const VERIFICATION_REQUIRED_CODE = 'VERIFICATION_REQUIRED';

/**
 * What the server said before it sent a code. Matched only as a fallback, so a
 * build talking to an older API still gets the prompt; the code is the contract.
 */
const LEGACY_MESSAGE = 'Account verification is required to perform this action.';

/** The code a 403 carries, inferring it for an older API that sent text only. */
export function resolveForbiddenCode(status, code, message) {
  if (code) return code;
  if (status === 403 && message === LEGACY_MESSAGE) return VERIFICATION_REQUIRED_CODE;
  return code;
}
