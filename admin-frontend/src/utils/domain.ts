/**
 * Email-domain input handling for the colleges form.
 *
 * Admins paste domains in all sorts of shapes: "@gla.ac.in", "GLA.AC.IN ",
 * "https://gla.ac.in/", or a whole address ("someone@gla.ac.in"). The API
 * normalizes again, but doing it here means the form shows exactly what will
 * be saved and a typo is reported before the request, not after.
 */

/** One raw entry -> bare lowercase domain ("" when nothing usable is left). */
export function normalizeDomain(raw: string): string {
  let d = raw.normalize('NFKC').trim().toLowerCase();
  d = d.replace(/^mailto:/, '').replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  d = d.split(/[/?#]/)[0] ?? '';
  // Everything up to the last "@" is a local part or a leading "@".
  const at = d.lastIndexOf('@');
  if (at !== -1) d = d.slice(at + 1);
  return d.replace(/^\.+|\.+$/g, '').trim();
}

/** A domain needs at least one dot and no whitespace, "@" or slash. */
export function isPlausibleDomain(domain: string): boolean {
  return /^[^\s@/]+\.[^\s@/.]+$/.test(domain) && !domain.includes('..');
}

export interface ParsedDomains {
  /** Normalized, de-duplicated, order preserved (first one is the primary). */
  domains: string[];
  /** Normalized entries that do not look like a domain. */
  invalid: string[];
}

/** Splits a comma / space / newline separated field into normalized domains. */
export function parseDomains(input: string): ParsedDomains {
  const seen = new Set<string>();
  const domains: string[] = [];
  const invalid: string[] = [];
  for (const part of input.split(/[,;\s]+/)) {
    const d = normalizeDomain(part);
    if (!d || seen.has(d)) continue;
    seen.add(d);
    (isPlausibleDomain(d) ? domains : invalid).push(d);
  }
  return { domains, invalid };
}
