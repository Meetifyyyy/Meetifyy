import { APP_ENV, IS_PRODUCTION, IS_STAGING } from './env';
import { appConfigValues } from './app.config';
import { authConfigValues } from './auth.config';
import { databaseConfigValues } from './database.config';
import { redisConfigValues } from './redis.config';
import { storageConfigValues } from './storage.config';

/**
 * Cross-environment isolation guard.
 *
 * `assertEnvValid()` checks that each variable is individually well-formed. It
 * cannot see the failure mode this guard exists for: every variable present and
 * valid, but pointing at *another environment's* resources — a production
 * container booting against the dev Postgres, the dev Redis (shared sessions,
 * rate-limit counters, presence and BullMQ queues) or the dev R2 bucket.
 *
 * That is precisely the mix-up that namespacing alone does not prevent:
 * `REDIS_QUEUE_PREFIX` keeps two environments off each other's *queues*, but
 * they still share one keyspace, one memory budget and one eviction policy, and
 * a `FLUSHALL` in dev still empties production's cache and sessions.
 *
 * The check is deliberately heuristic — it matches the `dev`/`development`
 * naming this project actually uses for its dev resources. It runs only in
 * staging and production, so development is never encumbered by it, and it
 * fails the boot rather than warning: a production process that has already
 * accepted one request against the dev database has already done the damage.
 *
 * DEV_RESOURCE_CHECK_DISABLED=true escapes it for the rare legitimate case (a
 * production-named resource that genuinely contains "dev", e.g. a hostname like
 * `devon-db.example.com`). It is deliberately awkward and logged.
 */

/** Matches a `dev`/`development`/`staging` token at a word-ish boundary. */
function looksLikeDevResource(value: string, tokens: string[]): boolean {
  if (!value) return false;
  return tokens.some((token) =>
    new RegExp(`(^|[^a-z0-9])${token}([^a-z0-9]|$)`, 'i').test(value),
  );
}

/**
 * Only the identifying part of a connection string is inspected — never the
 * credentials inside it, which must not reach a log or an error message.
 */
function safeTarget(connectionString: string): string {
  if (!connectionString) return '';
  try {
    const parsed = new URL(connectionString);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    // Not URL-shaped (e.g. a host:port pair). Strip anything after an `@` so a
    // password embedded in a non-URL form is still never examined or echoed.
    return connectionString.includes('@')
      ? connectionString.slice(connectionString.lastIndexOf('@') + 1)
      : connectionString;
  }
}

export function assertEnvironmentIsolation(): void {
  if (!IS_PRODUCTION && !IS_STAGING) return;

  if (process.env.DEV_RESOURCE_CHECK_DISABLED === 'true') {
    console.warn(
      `[isolation] DEV_RESOURCE_CHECK_DISABLED=true — cross-environment ` +
        `resource checks are SKIPPED for APP_ENV="${APP_ENV}".`,
    );
    return;
  }

  // In production, a resource named for either dev or staging is wrong. In
  // staging, "staging" is correct and only dev naming is a mistake.
  const forbidden = IS_PRODUCTION
    ? ['dev', 'development', 'staging', 'stage']
    : ['dev', 'development'];

  const problems: string[] = [];

  const check = (label: string, variable: string, value: string) => {
    const target = safeTarget(value);
    if (looksLikeDevResource(target, forbidden)) {
      problems.push(
        `${label} (${variable}) points at "${target}", which is named like a ` +
          `non-${APP_ENV} resource.`,
      );
    }
  };

  check('Database', 'DATABASE_URL', databaseConfigValues.url);
  check('Database (direct)', 'DIRECT_URL', databaseConfigValues.directUrl);
  check('Redis', 'REDIS_URL', redisConfigValues.url);
  check('Redis', 'REDIS_HOST', redisConfigValues.host);
  check('Supabase', 'SUPABASE_URL', authConfigValues.supabase.url);
  check('R2 bucket', 'R2_BUCKET_NAME', storageConfigValues.r2.bucketName);
  check(
    'R2 verification bucket',
    'R2_VERIFICATION_BUCKET_NAME',
    storageConfigValues.r2.verificationBucketName,
  );
  check('Frontend URL', 'FRONTEND_URL', appConfigValues.frontendUrl);
  check('Admin URL', 'ADMIN_URL', appConfigValues.adminUrl);

  // A credentialed API must never answer every origin. `credentials: true` is
  // set unconditionally in main.ts, so a `*` here would hand any site on the
  // internet an authenticated session's responses.
  const wildcardOrigins = [
    ...appConfigValues.cors.origins,
    ...appConfigValues.cors.originPatterns,
  ].filter((origin) => origin === '*');

  if (wildcardOrigins.length > 0) {
    problems.push(
      `CORS (CORS_ORIGINS / CORS_ORIGIN_PATTERNS) contains "*", which allows ` +
        `every origin on a credentialed API. List the exact frontend and ` +
        `admin origins instead.`,
    );
  }

  if (problems.length === 0) return;

  const detail = problems.map((problem) => `  • ${problem}`).join('\n');
  throw new Error(
    `\nEnvironment isolation check failed for APP_ENV="${APP_ENV}".\n\n` +
      `${detail}\n\n` +
      `This process was about to use another environment's resources. Correct ` +
      `the variables in the Azure Container App Configuration blade (or Key ` +
      `Vault) for this environment.\n`,
  );
}
