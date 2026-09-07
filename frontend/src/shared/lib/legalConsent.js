/**
 * The client half of the mandatory legal-acknowledgement gate.
 *
 * Kept out of `apiClient` for the same reason `accountStatusCorrection` is: the
 * response path should not grow flow logic inline, and this is testable without
 * standing up fetch.
 *
 * The gate itself is the server. Everything here exists so the user gets an
 * explanation and a way to accept, rather than a wall of generic 403 toasts
 * from every background request.
 */

/** The code `JwtGuard` sends when a required version has not been accepted. */
export const LEGAL_ACK_REQUIRED_CODE = 'LEGAL_ACKNOWLEDGEMENT_REQUIRED';

/**
 * Same-tab listeners do not receive their own `storage` event, and this has to
 * reach a component mounted in the same tab that made the failing request.
 */
export const LEGAL_CONSENT_EVENT = 'meetifyy:legal-consent';

/**
 * Written when acceptance completes, and read by other tabs.
 *
 * The point is the multi-tab case: a user with the modal open in three tabs
 * accepts in one, and the other two must stop blocking without a reload. The
 * value is a timestamp rather than a flag — it only ever means "re-ask the
 * server", never "you are cleared". Clearing the gate is the server's decision,
 * and a value written into storage by anything else cannot make it.
 */
export const LEGAL_CONSENT_STORAGE_KEY = 'meetifyy_legal_consent_at';

/**
 * Announces that this tab should re-check its consent state.
 *
 * @param reason 'required' when a request came back gated, 'accepted' when an
 *               acknowledgement just succeeded here.
 */
export function announceLegalConsentChange(reason, options = {}) {
  const emitter = options.emitter ?? globalThis.window;
  const storage = options.storage ?? globalThis.localStorage;

  if (reason === 'accepted') {
    try {
      storage?.setItem(LEGAL_CONSENT_STORAGE_KEY, String(Date.now()));
    } catch {
      // Private mode or a quota failure. The other tabs then find out on their
      // next request instead, which is a slower path to the same place.
    }
  }

  try {
    emitter?.dispatchEvent?.(
      new CustomEvent(LEGAL_CONSENT_EVENT, { detail: { reason } }),
    );
  } catch {
    // No window (SSR, a worker). Nothing to notify.
  }
}

/**
 * A per-browser hint that this user had an outstanding requirement last time we
 * asked.
 *
 * Purpose: the gate cannot know whether to block until the server answers, and
 * rendering the app during that round-trip meant a visible flash of the shell
 * before the modal took over. With this, a browser that already knows a
 * requirement is outstanding blocks immediately on mount.
 *
 * Deliberately one-directional in the safe direction. Setting it can only make
 * the gate appear SOONER; the server still decides whether it clears, and a
 * forged or stale value can at worst hold this browser at a "checking" screen
 * for one request. It can never let anyone through — "no flag" simply means
 * "ask, and render the app meanwhile", which is what the server enforces anyway.
 */
export const LEGAL_PENDING_HINT_KEY = 'meetifyy_legal_pending';

export function readLegalPendingHint(storage = globalThis.localStorage) {
  try {
    return storage?.getItem(LEGAL_PENDING_HINT_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeLegalPendingHint(pending, storage = globalThis.localStorage) {
  try {
    if (pending) storage?.setItem(LEGAL_PENDING_HINT_KEY, '1');
    else storage?.removeItem(LEGAL_PENDING_HINT_KEY);
  } catch {
    // Private mode or a quota failure. The gate still works; it just goes back
    // to showing the app for the length of one request.
  }
}

/** True when an API error is the consent gate refusing the request. */
export function isLegalAckRequired(error) {
  return error?.code === LEGAL_ACK_REQUIRED_CODE;
}
