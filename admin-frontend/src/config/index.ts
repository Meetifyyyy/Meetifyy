/**
 * Central admin-frontend configuration.
 *
 * The only module allowed to read `import.meta.env`. Everything else imports
 * `config` from here, so moving between local, staging and production is a
 * matter of build-time environment variables and never a source change.
 *
 * These values are inlined into the bundle at build time — only client-safe
 * values belong here.
 */

const raw = import.meta.env;

const problems: string[] = [];

const trimmed = (name: string): string => {
  const value = (raw as Record<string, unknown>)[name];
  return value === undefined || value === null ? '' : String(value).trim();
};

function str(name: string, { fallback = '', requiredInProd = false } = {}): string {
  const value = trimmed(name);
  if (value) return value;
  if (requiredInProd && raw.PROD) problems.push(`Missing required environment variable: ${name}`);
  return fallback;
}

function urlValue(name: string, { fallback = '', requiredInProd = false } = {}): string {
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

function int(name: string, { fallback = 0 } = {}): number {
  const value = trimmed(name);
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    problems.push(`Invalid ${name}: "${value}" is not an integer`);
    return fallback;
  }
  return parsed;
}

function bool(name: string, { fallback = false } = {}): boolean {
  const value = trimmed(name).toLowerCase();
  if (!value) return fallback;
  if (['true', '1', 'yes', 'on'].includes(value)) return true;
  if (['false', '0', 'no', 'off'].includes(value)) return false;
  problems.push(`Invalid ${name}: "${value}" is not a boolean (use true/false)`);
  return fallback;
}

export const IS_DEV_BUILD = import.meta.env.DEV;
export const MODE = import.meta.env.MODE;

export const config = {
  env: str('VITE_APP_ENV', { fallback: MODE }),
  isDevBuild: IS_DEV_BUILD,

  app: {
    name: str('VITE_APP_NAME', { fallback: 'Meetifyy Admin' }),
  },

  api: {
    /** Absolute API origin. Empty means same-origin. */
    baseUrl: urlValue('VITE_API_URL', { requiredInProd: true }),
    /** Backend port when it runs alongside this app on a developer machine. */
    localPort: int('VITE_API_LOCAL_PORT', { fallback: 4000 }),
    /** Whether a localhost/LAN page should talk to a backend on the same host. */
    preferLocalBackend: bool('VITE_API_PREFER_LOCAL', { fallback: IS_DEV_BUILD }),
  },
};

if (problems.length > 0) {
  const detail = problems.map((message) => `  • ${message}`).join('\n');
  throw new Error(
    `\nAdmin frontend environment configuration is invalid (mode: ${MODE}).\n\n${detail}\n\n` +
      `See admin-frontend/.env.example for the full list of variables.\n`,
  );
}

export default config;
