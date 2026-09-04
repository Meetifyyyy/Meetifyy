/**
 * Strict email-format validation, shared by every signup surface.
 *
 * This exists because the regex it replaces — `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` —
 * accepted addresses that are not addresses. `student@gla.ac.` passes it: the
 * greedy `[^\s@]+` matches `gla`, the literal dot matches, and the trailing
 * `[^\s@]+` happily matches `ac.` because a dot is neither whitespace nor an
 * `@`. So a half-typed domain reached the availability endpoint, was rejected
 * there as malformed input, and the client read that rejection as "the network
 * is down" and offered to let the user continue anyway.
 *
 * The rules below are deliberately stricter than RFC 5322. This validates
 * addresses people type into a signup form, not every string a mail server
 * must accept, so quoted local parts, IP-literal domains and single-label
 * hosts are all rejected. Being too permissive here is what caused the bug;
 * being slightly too strict costs a user nothing but a clearer message.
 *
 * Mirrored on the server in `backend/src/common/validation/email-format.util.ts`.
 * The two must agree: if they drift, the client will either block an address
 * the server would accept or wave through one the server will refuse at signup.
 */

/** Machine-readable outcomes. The UI maps these to copy; never string-match. */
export const EMAIL_FORMAT = {
  VALID: 'valid',
  REQUIRED: 'required',
  INVALID: 'invalid',
};

const MAX_EMAIL_LENGTH = 254; // RFC 5321 path limit
const MAX_LOCAL_LENGTH = 64;
const MAX_LABEL_LENGTH = 63;

/** One DNS label: alphanumeric ends, hyphens permitted only inside. */
const LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
/** Local part: the printable subset a signup form should accept. */
const LOCAL = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;

/**
 * Is this a syntactically complete address?
 *
 * Returns a code rather than a boolean so callers can distinguish "nothing
 * typed yet" from "typed something that cannot be an address" — the difference
 * between staying quiet and showing an error.
 *
 * @param {string} raw
 * @returns {{ code: string, valid: boolean, domain: string|null }}
 */
export function checkEmailFormat(raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return { code: EMAIL_FORMAT.REQUIRED, valid: false, domain: null };

  const invalid = { code: EMAIL_FORMAT.INVALID, valid: false, domain: null };

  if (value.length > MAX_EMAIL_LENGTH) return invalid;
  // Lowercased only for inspection. The caller decides what to send; see
  // normalizeEmail below for why the local part is not folded blindly.
  const lowered = value.toLowerCase();

  // Exactly one @, with content on both sides.
  const at = lowered.indexOf('@');
  if (at < 1 || at !== lowered.lastIndexOf('@') || at === lowered.length - 1) {
    return invalid;
  }

  const local = lowered.slice(0, at);
  const domain = lowered.slice(at + 1);

  if (local.length > MAX_LOCAL_LENGTH || !LOCAL.test(local)) return invalid;

  // A trailing dot is the specific case the old regex let through. Rejected
  // here rather than trimmed: `student@gla.ac.` is an address the user has not
  // finished typing, and silently repairing it into `student@gla.ac` would
  // hand them a different address than the one on screen.
  if (domain.startsWith('.') || domain.endsWith('.') || domain.includes('..')) {
    return invalid;
  }
  if (domain.length > 253) return invalid;

  const labels = domain.split('.');
  // At least one label plus a TLD. `student@gla` and `student@localhost` are
  // not college addresses and must not reach the domain check.
  if (labels.length < 2) return invalid;
  for (const label of labels) {
    if (!label || label.length > MAX_LABEL_LENGTH || !LABEL.test(label)) {
      return invalid;
    }
  }

  // TLD: letters only, two or more. Rules out `student@gla.ac.1` and `x@y.a`.
  const tld = labels[labels.length - 1];
  if (tld.length < 2 || !/^[a-z]+$/.test(tld)) return invalid;

  return { code: EMAIL_FORMAT.VALID, valid: true, domain };
}

/** Convenience boolean for call sites that only need a yes/no. */
export function isValidEmail(raw) {
  return checkEmailFormat(raw).valid;
}

/**
 * The form of the address to send to the server.
 *
 * Trim and lowercase only. No dot-stripping, no plus-tag removal, no repair of
 * a malformed value: normalisation must never turn an address the user cannot
 * sign in with into one that passes validation. Callers must check
 * `checkEmailFormat` first; this does not validate.
 */
export function normalizeEmail(raw) {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}
