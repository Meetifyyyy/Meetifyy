/**
 * Batch-year parsing for institutional email addresses.
 *
 * PURE FUNCTIONS ONLY. Nothing here reads the database, the clock or the
 * environment, so the parse is deterministic and testable on its own, and the
 * *policy* built on top of it (StudentYearPolicyService) is the only place
 * that knows what "first year" means right now.
 *
 * -- The address shape ------------------------------------------------------
 *
 * A GLA University address encodes the student's joining batch in the local
 * part, immediately after the academic-programme identifier:
 *
 *     sarthak.saini_cs25@gla.ac.in         -> programme cs      -> batch 2025
 *     shrangika.agnihotri_cs.h25@gla.ac.in -> programme cs.h    -> batch 2025
 *     aman.usmani_cs.aiml25@gla.ac.in      -> programme cs.aiml -> batch 2025
 *     aaradhya.rawat_cs.h24@gla.ac.in      -> programme cs.h    -> batch 2024
 *     dixita.mishra_cs24@gla.ac.in         -> programme cs      -> batch 2024
 *
 * So the year is the digits that terminate the local part, and they only count
 * as a year when a programme token -- letters, optionally dotted -- sits
 * between the last underscore and them. That anchor is what keeps this from
 * reading a digit out of somebody's name: `arjun.kumar2@example.com` has
 * trailing digits and no programme, and parses to nothing.
 *
 * -- Why it fails closed ----------------------------------------------------
 *
 * Every unrecognised address returns `null` -- "unresolved", never a guess and
 * never a default. A user whose batch cannot be read is NOT first-year (see
 * StudentYearPolicyService.isFirstYearBatch), because the alternative would
 * hand anyone with an unparseable address a first-year student's audience.
 */

/** The parse could not identify a batch year for this address. */
export const UNRESOLVED_BATCH_YEAR = null;

/**
 * Programme token followed by a four-digit year -- `_cs2025`, `_cs.aiml2025`.
 * Tried first because it is unambiguous; a four-digit tail would otherwise be
 * read by the two-digit pattern as its last two digits.
 */
const FOUR_DIGIT_BATCH = /_([a-z]+(?:\.[a-z]+)*)((?:19|20)\d{2})$/;

/** Programme token followed by the usual two-digit year -- `_cs25`, `_cs.h24`. */
const TWO_DIGIT_BATCH = /_([a-z]+(?:\.[a-z]+)*)(\d{2})$/;

/**
 * Invisible characters that would otherwise let a visually identical address
 * parse differently: zero-width spaces/joiners, the BOM, C0/C1 controls and
 * ordinary whitespace. Stripping them mirrors the normalisation
 * DomainValidatorService applies before it decides which college an address
 * belongs to, so the two cannot disagree about what an address *is*.
 */
// Stripping control characters is the point: an address carrying one must
// normalise to the same string as the address without it, or two visually
// identical addresses parse to different batches.
// eslint-disable-next-line no-control-regex
const INVISIBLE_CHARS = /[\u200B-\u200D\uFEFF\u0000-\u001F\u007F-\u009F\s]/g;

function normalizeEmail(email: string): string {
  return email.replace(INVISIBLE_CHARS, '').normalize('NFKC').toLowerCase();
}

/**
 * The batch (joining) year encoded in an institutional email address, or
 * `null` when the address does not carry one.
 *
 * Two-digit years are expanded into the 2000s: `24` -> 2024, `25` -> 2025,
 * `26` -> 2026, `27` -> 2027. Plausibility is deliberately NOT checked here --
 * that needs to know the current academic year, which is the policy's job.
 */
export function extractBatchYearFromEmail(
  email: unknown,
): number | typeof UNRESOLVED_BATCH_YEAR {
  if (typeof email !== 'string' || email.length === 0) {
    return UNRESOLVED_BATCH_YEAR;
  }

  const cleaned = normalizeEmail(email);

  // Split on the LAST '@' so a quoted local part containing one cannot move
  // the boundary and present a different string to the pattern.
  const at = cleaned.lastIndexOf('@');
  if (at <= 0 || at === cleaned.length - 1) return UNRESOLVED_BATCH_YEAR;

  const local = cleaned.slice(0, at);

  // Plus-addressing is refused outright rather than parsed. `x_cs25+foo@...`
  // and `x_cs25+cs26@...` are the same mailbox as `x_cs25@...` at most
  // providers, so honouring the tag would let one verified address present two
  // different batches -- exactly the bypass this policy exists to prevent. The
  // rule is moot for addresses that reach a batch through the anchored
  // patterns below (a tag breaks the anchor), but it is stated so the refusal
  // is a decision rather than an accident of the regex.
  if (local.includes('+')) return UNRESOLVED_BATCH_YEAR;

  const fourDigit = FOUR_DIGIT_BATCH.exec(local);
  if (fourDigit) return Number(fourDigit[2]);

  const twoDigit = TWO_DIGIT_BATCH.exec(local);
  if (twoDigit) return 2000 + Number(twoDigit[2]);

  return UNRESOLVED_BATCH_YEAR;
}

/**
 * The programme identifier that anchored the batch year -- `cs`, `cs.h`,
 * `cs.aiml`. Not used for access control; it exists so a parse can be logged
 * with enough context to tell "address format we do not know" apart from
 * "format we know, year we rejected".
 */
export function extractProgrammeFromEmail(email: unknown): string | null {
  if (typeof email !== 'string' || email.length === 0) return null;
  const cleaned = normalizeEmail(email);
  const at = cleaned.lastIndexOf('@');
  if (at <= 0) return null;
  const local = cleaned.slice(0, at);
  if (local.includes('+')) return null;
  const match = FOUR_DIGIT_BATCH.exec(local) ?? TWO_DIGIT_BATCH.exec(local);
  return match ? match[1] : null;
}

/**
 * How far back a batch year may sit before it is treated as unresolved.
 *
 * A degree does not run for twenty years, so a `_cs04` on a live account is
 * far likelier to be a mis-parse than a real 2004 intake. Wide enough that no
 * genuine student is ever rejected by it.
 */
export const MAX_BATCH_AGE_YEARS = 20;

/**
 * Sanity-bounds a parsed year against the current academic year.
 *
 * The bound reaches one year into the FUTURE, because addresses are issued
 * shortly before the intake they name: a `26` address is legitimately in
 * circulation during 2025.
 */
export function isPlausibleBatchYear(
  batchYear: number | null | undefined,
  currentYear: number,
): boolean {
  if (typeof batchYear !== 'number' || !Number.isInteger(batchYear)) {
    return false;
  }
  return (
    batchYear >= currentYear - MAX_BATCH_AGE_YEARS &&
    batchYear <= currentYear + 1
  );
}
