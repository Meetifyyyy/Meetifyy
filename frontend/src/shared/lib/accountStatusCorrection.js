/**
 * Reconciles the cached profile with an account state the SERVER knows about
 * and this tab does not.
 *
 * Both full-screen gates — `AccountDeletionGate` and `SuspensionGate` — mount
 * off `currentUser.accountStatus`, which is written at sign-in and refreshed on
 * a full sync. That leaves a real gap: a tab left open while the account was
 * suspended elsewhere, or put into its deletion window from the settings screen
 * in another tab, still holds `ACTIVE`. It never mounts its gate, so instead of
 * the explanation the user gets a stream of generic 403 toasts from every
 * background fetch.
 *
 * Every authenticated 403 carries a machine-readable code, so the correction is
 * already in the response — this just applies it.
 *
 * Kept out of `apiClient` so it can be tested without standing up fetch, and
 * because the response path should not grow storage logic inline.
 */

/**
 * Error code → the account status it proves.
 *
 * A whitelist, and deliberately one-directional: every entry moves the account
 * into a MORE restricted state. There is no code here that can return an
 * account to ACTIVE, so a forged or replayed 403 can only ever lock this tab's
 * UI — never unlock it. Unlocking happens through recovery or a real sync,
 * both of which are server-authoritative.
 */
export const ACCOUNT_STATUS_BY_ERROR_CODE = Object.freeze({
  ACCOUNT_PENDING_DELETION: 'PENDING_DELETION',
  ACCOUNT_SUSPENDED: 'SUSPENDED',
});

/** Same-tab listeners do not receive their own `storage` event. */
export const ACCOUNT_STATUS_EVENT = 'meetifyy:account-status';

/**
 * Applies the correction implied by `errorCode`, if any.
 *
 * @returns the status written, or null when nothing changed — so a caller (and
 *          a test) can tell "corrected" from "not applicable" without inspecting
 *          storage.
 */
export function applyAccountStatusCorrection(errorCode, options = {}) {
  const storage = options.storage ?? globalThis.localStorage;
  const emitter = options.emitter ?? globalThis.window;

  const status = ACCOUNT_STATUS_BY_ERROR_CODE[errorCode];
  if (!status || !storage) return null;

  try {
    const raw = storage.getItem('currentUser');
    if (!raw) return null;

    const user = JSON.parse(raw);
    // Nothing to do, and re-writing would fire a pointless storage event in
    // every other tab on every subsequent 403.
    if (!user || user.accountStatus === status) return null;

    storage.setItem(
      'currentUser',
      JSON.stringify({ ...user, accountStatus: status }),
    );
    emitter?.dispatchEvent?.(
      new CustomEvent(ACCOUNT_STATUS_EVENT, { detail: { status } }),
    );
    return status;
  } catch {
    // Private mode, a quota failure, or corrupt JSON. None of these may break
    // the request path — the next full sync corrects the status anyway.
    return null;
  }
}
