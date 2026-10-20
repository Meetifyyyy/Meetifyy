import { openVerificationModal } from '@shared/stores/verificationModalStore';
import { VERIFICATION_REQUIRED_CODE } from '@core/api/verificationRequired';

/**
 * Turns the API's "verify your account" 403 into the app's existing
 * verification prompt, whatever screen made the request.
 *
 * Screens already pre-check and open this prompt themselves; this covers the
 * rest (a stale cached profile, a send path nobody pre-checked) so the user
 * gets "Verify with live selfie" instead of a generic failure.
 *
 * @returns true when the code was the verification gate and the prompt opened.
 */
export function handleVerificationRequired(errorCode, open = openVerificationModal) {
  if (errorCode !== VERIFICATION_REQUIRED_CODE) return false;
  open('Verify your account to do this. A quick live selfie is all it takes.');
  return true;
}
