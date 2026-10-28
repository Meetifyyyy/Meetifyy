/** Shown when a college has no domain on record (a code restored after a reload). */
const FALLBACK_DOMAIN = 'college.edu';

/** The college's primary domain (the API lists it first), or '' when none is on record. */
export function primaryDomain(college) {
  const domains = Array.isArray(college?.domains) ? college.domains : [];
  return (
    domains
      .map((d) => (typeof d === 'string' ? d.trim().replace(/^@/, '').toLowerCase() : ''))
      .find(Boolean) || ''
  );
}

/**
 * The email placeholder for a college: `you@` plus its real domain, the primary
 * one first (the API lists it first). A hint only. The server decides which
 * addresses belong to the college.
 */
export function emailPlaceholder(college) {
  return `you@${primaryDomain(college) || FALLBACK_DOMAIN}`;
}
