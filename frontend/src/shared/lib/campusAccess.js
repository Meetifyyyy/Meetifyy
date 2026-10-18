/**
 * Who may see Campus, decided on the client for presentation only.
 *
 * Campus is gated by a verified college email (`campusAffiliation`), not by the
 * live-selfie check (`verificationStatus`). The two used to be one question and
 * are now deliberately separate: a person can be selfie-verified with no
 * college, or have a college email with no selfie.
 *
 * The server decides on its own (403 `campus_affiliation_required`); nothing
 * here is a security boundary. Its job is to show the right screen and to not
 * fire requests that are certain to be refused.
 *
 * Rollout: the frontend and the API deploy independently, so for a while this
 * code can be talking to an API that has never heard of affiliations. That API
 * sends users without the `campusAffiliation` key at all, which is different
 * from sending it as `null` ("known: none"). Absent means "ask the affiliation
 * endpoint"; if that 404s too, the old rule applies (selfie-verified with a
 * college), so a frontend that ships first locks nobody out.
 */

/** Query keys of every cache that holds campus-only content. */
export const CAMPUS_GATED_QUERY_KEYS = [
  ['campusUsers'],
  ['directory'],
  ['campus-events'],
  ['communities', 'campus'],
];

/** The affiliation status query (GET /api/campus/affiliation). */
export const CAMPUS_AFFILIATION_QUERY_KEY = ['campus', 'affiliation'];

/** The 403 code campus routes answer with for a caller without an affiliation. */
export const CAMPUS_AFFILIATION_REQUIRED = 'campus_affiliation_required';

/** Whether the server told us about affiliations at all (key present, even as null). */
export function hasAffiliationField(user) {
  return Boolean(user) && Object.prototype.hasOwnProperty.call(user, 'campusAffiliation');
}

/** An affiliation that grants Campus right now. */
export function isAffiliationActive(affiliation) {
  return Boolean(affiliation && affiliation.active);
}

/** The pre-affiliation rule, used only when the API predates affiliations. */
export function legacyCampusAccess(user) {
  return Boolean(user) && user.verificationStatus === 'VERIFIED' && Boolean(user.collegeId);
}

/** Whether an error is the server refusing a campus route for lack of an affiliation. */
export function isCampusAffiliationError(err) {
  return Boolean(err) && err.status === 403 && err.code === CAMPUS_AFFILIATION_REQUIRED;
}

/**
 * The user object after an affiliation change, with the mirror fields the
 * rest of the app still reads (`collegeId`, `college`, `collegeName`) kept in
 * step. `affiliation` null means it was removed.
 */
export function applyAffiliationToUser(user, affiliation) {
  if (!user) return user;
  if (!affiliation) {
    return {
      ...user,
      campusAffiliation: null,
      collegeId: null,
      collegeEmail: null,
      ...(user.college && typeof user.college === 'object' ? { college: null } : {}),
      ...(typeof user.collegeName === 'string' ? { collegeName: '' } : {}),
    };
  }
  const next = { ...user, campusAffiliation: affiliation };
  if (affiliation.active) {
    next.collegeId = affiliation.collegeId ?? user.collegeId ?? null;
    if (affiliation.collegeName) {
      next.collegeName = affiliation.collegeName;
      // `getCollegeName` prefers `college.name`, so an object left behind from
      // a previous college would keep showing the old name.
      if (!user.college || typeof user.college === 'object') {
        next.college = {
          ...(user.college && typeof user.college === 'object' ? user.college : {}),
          id: next.collegeId,
          name: affiliation.collegeName,
          ...(affiliation.logoUrl ? { logoUrl: affiliation.logoUrl } : {}),
        };
      }
    }
  }
  return next;
}

// The OTP service answers 429 with its own codes; route limits use `rate_limited`.
function describeRateLimit(err) {
  return err?.retryAfterSeconds
    ? `Too many requests. Try again in ${err.retryAfterSeconds}s.`
    : 'Too many requests. Wait a moment and try again.';
}

/** Maps the contract's error codes to sentences a student can act on. */
export function describeCampusOtpError(err) {
  switch (err?.code) {
    case 'invalid_college':
      return 'That college is not available for verification any more. Pick it again from the list.';
    case 'domain_mismatch':
      return "That address isn't on this college's email domain. Use the email your college gave you.";
    case 'college_email_unavailable':
      return "This college email can't be used. If it's yours, contact support.";
    case 'already_affiliated':
      return 'This college email is already verified on your account.';
    case 'invalid_code':
      return "That code isn't right. Check the email and try again.";
    case 'expired_code':
      return 'That code has expired. Send a new one.';
    case 'too_many_attempts':
      return 'Too many wrong codes. Send a new one and try again.';
    case 'rate_limited':
    case 'OTP_COOLDOWN':
    case 'OTP_RATE_LIMITED':
      return describeRateLimit(err);
    case 'affiliation_revoked':
      return 'Your college verification was revoked by Meetifyy. Contact support if you think this is a mistake.';
    case 'invalid_email':
      return "That doesn't look like a valid email address.";
    case 'invalid_password':
      return 'Your current password is incorrect.';
    default:
      if (err?.status === 429) return 'Too many requests. Wait a moment and try again.';
      if (!err?.status) return "We couldn't reach Meetifyy. Check your connection and try again.";
      return err?.message || 'Something went wrong. Please try again.';
  }
}

/** Same, for the personal-email change flow. */
export function describeAccountEmailError(err) {
  switch (err?.code) {
    case 'email_taken':
      return 'That email is already used by another account.';
    case 'same_email':
      return 'That is already your login email.';
    case 'invalid_code':
      return "That code isn't right. Check the email and try again.";
    case 'expired_code':
      return 'That code has expired. Send a new one.';
    case 'too_many_attempts':
      return 'Too many wrong codes. Send a new one and try again.';
    case 'invalid_password':
      return 'Your current password is incorrect.';
    case 'invalid_email':
      return "That doesn't look like a valid email address.";
    case 'rate_limited':
    case 'OTP_COOLDOWN':
    case 'OTP_RATE_LIMITED':
      return describeRateLimit(err);
    default:
      if (err?.status === 429) return 'Too many requests. Wait a moment and try again.';
      if (!err?.status) return "We couldn't reach Meetifyy. Check your connection and try again.";
      return err?.message || 'Something went wrong. Please try again.';
  }
}
