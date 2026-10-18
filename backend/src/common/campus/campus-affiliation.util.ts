import {
  checkEmailFormat,
  normalizeEmail,
} from '../validation/email-format.util';

/**
 * Pure helpers for the college-affiliation model, shared by the affiliation
 * service, the auth sync payload, the admin console and the campus gate.
 *
 * Kept free of Nest and Prisma runtime imports so every caller (and every
 * spec) can use them without pulling in a module graph.
 */

/** Domain normalization, as `DomainValidatorService.normalizeDomain` does it. */
export interface DomainNormalizer {
  normalizeDomain(rawDomain: string): string;
}

/**
 * The one definition of a normalized college address.
 *
 * NFKC, invisible characters stripped, trimmed, lowercased, and the domain
 * converted to ASCII by the same rules the approved-domain lookup uses. The
 * local part is kept as typed (lowercased): institutions differ on whether dots
 * or `+tags` are significant, so no stripping.
 *
 * For a plain ASCII address the result equals SQL `lower(trim(email))`, which
 * is what migration 00000000000014 used for the legacy backfill.
 *
 * Returns null for anything that is not a well-formed address.
 */
export function normalizeCollegeEmail(
  raw: unknown,
  domains: DomainNormalizer,
): string | null {
  const cleaned = normalizeEmail(raw);
  const at = cleaned.indexOf('@');
  if (at < 1 || at !== cleaned.lastIndexOf('@')) return null;
  let domain: string;
  try {
    domain = domains.normalizeDomain(cleaned.slice(at + 1));
  } catch {
    return null;
  }
  const candidate = `${cleaned.slice(0, at)}@${domain}`;
  return checkEmailFormat(candidate).valid ? candidate : null;
}

/** The domain part of an already-normalized address. */
export function domainOf(normalizedEmail: string): string {
  return normalizedEmail.slice(normalizedEmail.indexOf('@') + 1);
}

/**
 * `ab***@college.edu`. Enough for the owner to recognise their own address,
 * not enough to read it off a shoulder-surfed screen or a screenshot.
 */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return '';
  const at = email.indexOf('@');
  if (at < 1) return '***';
  const local = email.slice(0, at);
  const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${visible}***${email.slice(at)}`;
}

/** A stored logo reference as a URL the client can render. */
export function collegeLogoUrl(
  logoKey: string | null | undefined,
): string | null {
  if (!logoKey) return null;
  if (/^https?:\/\//i.test(logoKey) || logoKey.startsWith('/')) return logoKey;
  return `/api/media/${logoKey}`;
}

/** What makes a college able to carry campus access. */
export interface CollegeGateFields {
  isActive: boolean;
  status: string;
  deletedAt: Date | null;
}

export function isCollegeOpen(college: CollegeGateFields | null | undefined) {
  return Boolean(
    college &&
    college.isActive &&
    college.status === 'APPROVED' &&
    college.deletedAt === null,
  );
}

/** The fields the client-facing affiliation view is built from. */
export interface AffiliationViewSource {
  collegeId: string;
  email: string;
  /** A `CollegeAffiliationMethod`; a string because raw SQL rows carry it as one. */
  method: string;
  verifiedAt: Date;
  revokedAt: Date | null;
  college: CollegeGateFields & { name: string; logoKey: string | null };
}

/** `GET /api/campus/affiliation` → `affiliation`, and the sync payload's `campusAffiliation`. */
export interface AffiliationView {
  collegeId: string;
  collegeName: string;
  logoUrl: string | null;
  /** Masked. The full address never leaves the server in this payload. */
  email: string;
  method: string;
  verifiedAt: string;
  active: boolean;
}

export function presentAffiliation(
  row: AffiliationViewSource | null | undefined,
): AffiliationView | null {
  if (!row) return null;
  return {
    collegeId: row.collegeId,
    collegeName: row.college.name,
    logoUrl: collegeLogoUrl(row.college.logoKey),
    email: maskEmail(row.email),
    method: String(row.method),
    verifiedAt: new Date(row.verifiedAt).toISOString(),
    active: row.revokedAt === null && isCollegeOpen(row.college),
  };
}

/** How long "Later" on the Complete-your-profile prompt lasts at most. */
export const PROFILE_PROMPT_SNOOZE_MS = 10 * 24 * 60 * 60 * 1000;

/** The stored "Later" press: when, and from which session. */
export interface ProfilePromptSnooze {
  laterAt: Date | null | undefined;
  laterSessionId: string | null | undefined;
}

/**
 * Whether "Later" is still in force: pressed less than 10 days ago AND from
 * the session making this request. A different session id means the account
 * signed in again since (on any device), which ends the snooze. A request with
 * no resolvable session id is never snoozed, so the prompt can only re-show,
 * never stay hidden wrongly.
 */
export function isProfilePromptSnoozed(
  snooze: ProfilePromptSnooze | null | undefined,
  currentSessionId: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!snooze?.laterAt || !snooze.laterSessionId || !currentSessionId) {
    return false;
  }
  if (snooze.laterSessionId !== currentSessionId) return false;
  const age = now.getTime() - new Date(snooze.laterAt).getTime();
  return age >= 0 && age < PROFILE_PROMPT_SNOOZE_MS;
}

/** `profileCompletion` on the session/sync payload. */
export interface ProfileCompletion {
  needsPersonalEmail: boolean;
  needsGender: boolean;
  /** Additive: older installed apps ignore it. */
  promptSnoozed: boolean;
}

/**
 * `needsPersonalEmail`: the account has an affiliation and still signs in with
 * that same college address. `needsGender`: no gender recorded.
 * `promptSnoozed`: see `isProfilePromptSnoozed`; `false` unless a snooze and
 * the caller's session id are both supplied.
 */
export function profileCompletion(input: {
  email: string | null | undefined;
  gender: string | null | undefined;
  affiliationEmailNormalized: string | null | undefined;
  snooze?: ProfilePromptSnooze | null;
  currentSessionId?: string | null;
  now?: Date;
}): ProfileCompletion {
  const login = normalizeEmail(input.email ?? '');
  return {
    needsPersonalEmail: Boolean(
      input.affiliationEmailNormalized &&
      login &&
      login === input.affiliationEmailNormalized,
    ),
    needsGender: !input.gender,
    promptSnoozed: isProfilePromptSnoozed(
      input.snooze,
      input.currentSessionId,
      input.now,
    ),
  };
}
