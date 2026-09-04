/**
 * Strict email-format validation — the server half of the pair.
 *
 * Mirrors `frontend/src/shared/utils/emailValidation.js` rule for rule. The two
 * must agree: if the client is stricter the user is blocked from an address the
 * server would take; if the server is stricter the user is waved through a step
 * that fails later at signup, which is the worse of the two.
 *
 * It replaces `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`, which accepted `student@gla.ac.`
 * — the greedy first group takes `gla`, the dot matches, and the final group
 * matches `ac.` because a dot is neither whitespace nor an `@`.
 *
 * Deliberately stricter than RFC 5322: this validates what a person types into
 * a signup form, so quoted local parts, IP-literal domains and single-label
 * hosts are all rejected.
 */

export enum EmailFormat {
  Valid = 'valid',
  Required = 'required',
  Invalid = 'invalid',
}

export interface EmailFormatResult {
  code: EmailFormat;
  valid: boolean;
  /** Lowercased domain, present only when `valid` is true. */
  domain: string | null;
}

const MAX_EMAIL_LENGTH = 254; // RFC 5321 path limit
const MAX_LOCAL_LENGTH = 64;
const MAX_DOMAIN_LENGTH = 253;
const MAX_LABEL_LENGTH = 63;

const LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const LOCAL =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;

/**
 * Strips characters that are invisible or that a terminal/parser may treat as
 * structure, so an address padded with a zero-width space cannot present as a
 * different string to the validator than it does to the domain lookup.
 */
function stripInvisible(value: string): string {
  // Zero-width space/non-joiner/joiner, BOM, and C0/C1 control ranges.
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u200B-\u200D\uFEFF\u0000-\u001F\u007F-\u009F]/g, '');
}

export function checkEmailFormat(raw: unknown): EmailFormatResult {
  const invalid: EmailFormatResult = {
    code: EmailFormat.Invalid,
    valid: false,
    domain: null,
  };

  if (typeof raw !== 'string') return invalid;

  const value = stripInvisible(raw).normalize('NFKC').trim();
  if (!value) {
    return { code: EmailFormat.Required, valid: false, domain: null };
  }
  if (value.length > MAX_EMAIL_LENGTH) return invalid;

  const lowered = value.toLowerCase();

  const at = lowered.indexOf('@');
  if (at < 1 || at !== lowered.lastIndexOf('@') || at === lowered.length - 1) {
    return invalid;
  }

  const local = lowered.slice(0, at);
  const domain = lowered.slice(at + 1);

  if (local.length > MAX_LOCAL_LENGTH || !LOCAL.test(local)) return invalid;

  // A trailing dot is rejected, not trimmed. `DomainValidatorService` does strip
  // one when resolving an approved domain, which is correct for DNS — but doing
  // it here would repair a half-typed address into a different, valid-looking
  // one, which is exactly the class of bug this file exists to close.
  if (domain.startsWith('.') || domain.endsWith('.') || domain.includes('..')) {
    return invalid;
  }
  if (domain.length > MAX_DOMAIN_LENGTH) return invalid;

  const labels = domain.split('.');
  if (labels.length < 2) return invalid;
  for (const label of labels) {
    if (!label || label.length > MAX_LABEL_LENGTH || !LABEL.test(label)) {
      return invalid;
    }
  }

  const tld = labels[labels.length - 1];
  if (tld.length < 2 || !/^[a-z]+$/.test(tld)) return invalid;

  return { code: EmailFormat.Valid, valid: true, domain };
}

export function isValidEmailFormat(raw: unknown): boolean {
  return checkEmailFormat(raw).valid;
}

/**
 * Trim and lowercase only — never repair. Callers must run `checkEmailFormat`
 * first; this does not validate.
 */
export function normalizeEmail(raw: unknown): string {
  return typeof raw === 'string'
    ? stripInvisible(raw).normalize('NFKC').trim().toLowerCase()
    : '';
}
