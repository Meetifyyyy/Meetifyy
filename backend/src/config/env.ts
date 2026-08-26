/**
 * Central environment loader + validator.
 *
 * This is the ONLY place in the backend that is allowed to read `process.env`.
 * Everything else consumes the typed `config` object exported from
 * `src/config/index.ts` (or the `registerAs` namespaces bound to it).
 *
 * Load order (later files never override values already set by earlier ones,
 * matching the conventional dotenv precedence):
 *
 *   1. real process environment (Railway / Vercel / CI / shell)  ← always wins
 *   2. .env.<APP_ENV>.local      (developer-specific, git-ignored)
 *   3. .env.local                (developer-specific, git-ignored)
 *   4. .env.<APP_ENV>            (per-environment, non-secret defaults)
 *   5. .env                      (fallback / legacy)
 *
 * Validation runs once, at import time, and throws a single error listing every
 * problem — the process must never boot half-configured.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

export type AppEnvironment = 'development' | 'test' | 'staging' | 'production';

const KNOWN_ENVIRONMENTS: AppEnvironment[] = ['development', 'test', 'staging', 'production'];

const ENV_ROOT = path.resolve(__dirname, '..', '..');

/**
 * Reads a dotenv file without applying it to `process.env`.
 *
 * Used only to discover APP_ENV before the real load runs. Which files that
 * load reads depends on APP_ENV, so APP_ENV itself has to be settled first.
 */
function peekDotenv(file: string): Record<string, string> {
  const full = path.join(ENV_ROOT, file);
  if (!fs.existsSync(full)) return {};
  try {
    return dotenv.parse(fs.readFileSync(full));
  } catch {
    return {};
  }
}

function resolveAppEnv(): AppEnvironment {
  // APP_ENV exists so a staging deployment can run with NODE_ENV=production
  // (which the toolchain needs for optimised builds) while still selecting
  // staging configuration. It falls back to NODE_ENV everywhere else.
  //
  // The environment-agnostic dotenv files are consulted too, so that APP_ENV
  // can be declared in a file rather than only in the real process
  // environment. It previously could not: APP_ENV was resolved before any
  // file was loaded, so `APP_ENV=production` in a .env was read too late and
  // silently ignored, leaving the process in development.
  //
  // Only `.env` and `.env.local` are consulted here. `.env.<APP_ENV>` cannot
  // be: naming it requires the answer this function is computing.
  const fromFiles = { ...peekDotenv('.env'), ...peekDotenv('.env.local') };
  const raw = (
    process.env.APP_ENV ||
    process.env.NODE_ENV ||
    fromFiles.APP_ENV ||
    fromFiles.NODE_ENV ||
    'development'
  )
    .trim()
    .toLowerCase();
  return (KNOWN_ENVIRONMENTS as string[]).includes(raw) ? (raw as AppEnvironment) : 'development';
}

export const APP_ENV: AppEnvironment = resolveAppEnv();
export const IS_PRODUCTION = APP_ENV === 'production';
export const IS_STAGING = APP_ENV === 'staging';
export const IS_TEST = APP_ENV === 'test';
export const IS_DEVELOPMENT = APP_ENV === 'development';

function loadDotenvFiles(): void {
  // In a deployed environment the platform injects real environment variables;
  // dotenv files are a local-development convenience. Loading them is still
  // harmless there because `override` is never set.
  const candidates = [
    `.env.${APP_ENV}.local`,
    '.env.local',
    `.env.${APP_ENV}`,
    '.env',
  ];

  for (const file of candidates) {
    const full = path.join(ENV_ROOT, file);
    if (fs.existsSync(full)) {
      dotenv.config({ path: full, override: false, quiet: true });
    }
  }
}

loadDotenvFiles();

// ── Validation primitives ────────────────────────────────────────────────────

const errors: string[] = [];

function fail(message: string): void {
  errors.push(message);
}

function raw(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** Every environment — for variables that are mandatory everywhere. */
export const ALL_ENVIRONMENTS: AppEnvironment[] = KNOWN_ENVIRONMENTS;

interface Requirement {
  /**
   * Environments in which this variable must be present. Omit to make the
   * variable optional everywhere (an absent value then falls back to `default`,
   * or to an empty value).
   */
  requiredIn?: AppEnvironment[];
  /** Value used when the variable is absent and not required here. */
  default?: string;
}

function isRequiredHere(req?: Requirement): boolean {
  if (!req?.requiredIn) return false;
  return req.requiredIn.includes(APP_ENV);
}

/** A plain string. */
export function str(name: string, req?: Requirement): string {
  const value = raw(name);
  if (value !== undefined) return value;
  if (isRequiredHere(req)) {
    fail(`Missing required environment variable: ${name}`);
    return '';
  }
  return req?.default ?? '';
}

/** An absolute http(s) URL. Trailing slashes are stripped so callers can concatenate paths. */
export function url(name: string, req?: Requirement): string {
  const value = str(name, req);
  if (!value) return '';
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    fail(`Invalid ${name}: "${value}" is not a valid URL`);
    return '';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    fail(`Invalid ${name}: "${value}" must use http:// or https://`);
    return '';
  }
  if (IS_PRODUCTION && parsed.protocol === 'http:' && !isLocalHostname(parsed.hostname)) {
    fail(`Invalid ${name}: "${value}" must use https:// in production`);
    return '';
  }
  return value.replace(/\/+$/, '');
}

function isLocalHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

/** An integer, optionally range-checked. */
export function int(name: string, req?: Requirement & { min?: number; max?: number }): number {
  const value = str(name, req);
  if (!value) return NaN;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    fail(`Invalid ${name}: "${value}" is not an integer`);
    return NaN;
  }
  if (req?.min !== undefined && parsed < req.min) {
    fail(`Invalid ${name}: ${parsed} is below the minimum of ${req.min}`);
  }
  if (req?.max !== undefined && parsed > req.max) {
    fail(`Invalid ${name}: ${parsed} is above the maximum of ${req.max}`);
  }
  return parsed;
}

/** A float, typically a 0..1 sample rate. */
export function num(name: string, req?: Requirement & { min?: number; max?: number }): number {
  const value = str(name, req);
  if (!value) return NaN;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    fail(`Invalid ${name}: "${value}" is not a number`);
    return NaN;
  }
  if (req?.min !== undefined && parsed < req.min) fail(`Invalid ${name}: ${parsed} is below ${req.min}`);
  if (req?.max !== undefined && parsed > req.max) fail(`Invalid ${name}: ${parsed} is above ${req.max}`);
  return parsed;
}

/** A boolean written as true/false/1/0/yes/no. */
export function bool(name: string, req?: Requirement): boolean {
  const value = str(name, req).toLowerCase();
  if (!value) return false;
  if (['true', '1', 'yes', 'on'].includes(value)) return true;
  if (['false', '0', 'no', 'off'].includes(value)) return false;
  fail(`Invalid ${name}: "${value}" is not a boolean (use true/false)`);
  return false;
}

/** One of a fixed set of values. */
export function oneOf<T extends string>(name: string, allowed: readonly T[], req?: Requirement): T {
  const value = str(name, req) as T;
  if (!value) return '' as T;
  if (!allowed.includes(value)) {
    fail(`Invalid ${name}: "${value}" must be one of: ${allowed.join(', ')}`);
    return '' as T;
  }
  return value;
}

/** A comma-separated list. Empty entries are dropped and trailing slashes stripped. */
export function csv(name: string, req?: Requirement): string[] {
  const value = str(name, req);
  if (!value) return [];
  return Array.from(
    new Set(
      value
        .split(',')
        .map((entry) => entry.trim().replace(/\/+$/, ''))
        .filter(Boolean),
    ),
  );
}

/** An email address, optionally in `Name <addr@host>` form. */
export function email(name: string, req?: Requirement): string {
  const value = str(name, req);
  if (!value) return '';
  const address = value.includes('<') ? value.slice(value.indexOf('<') + 1, value.indexOf('>')) : value;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address.trim())) {
    fail(`Invalid ${name}: "${value}" is not a valid email address`);
    return '';
  }
  return value;
}

/** Records a cross-field problem discovered while assembling config. */
export function invariant(condition: boolean, message: string): void {
  if (!condition) fail(message);
}

/**
 * Throws if anything failed validation. Called once from `src/config/index.ts`
 * after every config slice has been built, so a single boot reports every
 * problem rather than one per restart.
 */
export function assertEnvValid(): void {
  if (errors.length === 0) return;
  const detail = errors.map((message) => `  • ${message}`).join('\n');
  throw new Error(
    `\nEnvironment configuration is invalid for APP_ENV="${APP_ENV}".\n\n${detail}\n\n` +
      `See .env.example for the full list of variables.\n`,
  );
}
