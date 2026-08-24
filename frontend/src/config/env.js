/**
 * Frontend environment loader + validator.
 *
 * This is the ONLY module in the frontend allowed to read `import.meta.env`.
 * Everything else imports the typed `config` object from `@config`.
 *
 * IMPORTANT — these are BUILD-TIME values. Vite inlines `import.meta.env.*` into
 * the bundle when it is built, so a production bundle carries whatever variables
 * were present during the production build. Changing a variable afterwards has
 * no effect until the app is rebuilt. See docs/environment-configuration.md.
 *
 * Only client-safe values may ever appear here: everything in this file ships to
 * the browser. Service-role keys, database URLs and API secrets belong to the
 * backend environment exclusively.
 */

const raw = import.meta.env;

const problems = [];

const trimmed = (name) => {
  const value = raw[name];
  if (value === undefined || value === null) return '';
  return String(value).trim();
};

/** A plain string with an optional fallback. */
export function str(name, { fallback = '', requiredInProd = false } = {}) {
  const value = trimmed(name);
  if (value) return value;
  if (requiredInProd && raw.PROD) problems.push(`Missing required environment variable: ${name}`);
  return fallback;
}

/** An absolute http(s) URL, normalised without a trailing slash. */
export function url(name, { fallback = '', requiredInProd = false } = {}) {
  const value = str(name, { fallback, requiredInProd });
  if (!value) return '';
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      problems.push(`Invalid ${name}: "${value}" must use http:// or https://`);
      return '';
    }
  } catch {
    problems.push(`Invalid ${name}: "${value}" is not a valid URL`);
    return '';
  }
  return value.replace(/\/+$/, '');
}

/** A boolean written as true/false/1/0. */
export function bool(name, { fallback = false } = {}) {
  const value = trimmed(name).toLowerCase();
  if (!value) return fallback;
  if (['true', '1', 'yes', 'on'].includes(value)) return true;
  if (['false', '0', 'no', 'off'].includes(value)) return false;
  problems.push(`Invalid ${name}: "${value}" is not a boolean (use true/false)`);
  return fallback;
}

/** An integer with an optional fallback. */
export function int(name, { fallback = 0 } = {}) {
  const value = trimmed(name);
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    problems.push(`Invalid ${name}: "${value}" is not an integer`);
    return fallback;
  }
  return parsed;
}

/** A comma-separated list. */
export function csv(name, { fallback = [] } = {}) {
  const value = trimmed(name);
  if (!value) return fallback;
  return Array.from(new Set(value.split(',').map((entry) => entry.trim()).filter(Boolean)));
}

/**
 * Throws when anything failed validation. Called once after the config object is
 * assembled, so a misconfigured build fails loudly at startup rather than at the
 * first request that happens to need a missing value.
 */
export function assertEnvValid() {
  if (problems.length === 0) return;
  const detail = problems.map((message) => `  • ${message}`).join('\n');
  throw new Error(
    `\nFrontend environment configuration is invalid (mode: ${raw.MODE}).\n\n${detail}\n\n` +
      `See frontend/.env.example and docs/environment-configuration.md.\n`,
  );
}

/**
 * Vite's own build-mode flags, exposed so no other module reads them directly.
 *
 * These are written as direct `import.meta.env.*` references on purpose: Vite
 * replaces exactly that token with a literal at build time, which is what lets
 * Rollup fold the flag and drop dev-only branches from the production bundle.
 * Reading them off an intermediate object (`raw.DEV`) would make them ordinary
 * runtime property accesses and defeat that elimination.
 */
export const MODE = import.meta.env.MODE;
export const IS_DEV_BUILD = import.meta.env.DEV;
export const IS_PROD_BUILD = import.meta.env.PROD;
