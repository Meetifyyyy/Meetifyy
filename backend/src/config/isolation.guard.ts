import { APP_ENV, IS_PRODUCTION, IS_STAGING, IS_TEST } from './env';
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
 * naming this project actually uses for its dev resources. The resource checks
 * run only in staging and production, so a developer's machine is never
 * encumbered by them. The CORS check runs in every deployed environment that
 * shares a cookie domain — including development, whose API was one of the two
 * that answered the other environment's pages; see `corsIsolationProblems`.
 * Both fail the boot rather than warning: a production process that has
 * already accepted one request against the dev database has already done the
 * damage.
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

/** The host of an origin, or '' when the entry is not URL-shaped. */
function hostOf(origin: string): string {
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Whether a host is named for the environment this process is running as.
 *
 * Production is the environment whose hosts carry no environment token, so for
 * it "ours" means "not named for any other". Every other environment names its
 * hosts after itself (`dev.`, `dev-admin.`, …), so for them "ours" means
 * "carries our token".
 */
function hostBelongsToThisEnvironment(host: string): boolean {
  if (IS_PRODUCTION) {
    return !looksLikeDevResource(host, [
      'dev',
      'development',
      'staging',
      'stage',
    ]);
  }
  const own =
    APP_ENV === 'development'
      ? ['dev', 'development']
      : IS_STAGING
        ? ['staging', 'stage']
        : [APP_ENV];
  return looksLikeDevResource(host, own);
}

/**
 * Labels tried in place of a wildcard to find out what a pattern can reach.
 * One per kind of host this project runs: a dev one, a staging one, and an
 * unmarked (production) one.
 */
const WILDCARD_PROBES = ['dev', 'dev-admin', 'staging', 'www', 'admin'];

/**
 * CORS entries that let ANOTHER environment's pages read this API.
 *
 * Development and production share one cookie domain, `COOKIE_DOMAIN`. The
 * cookie names keep their sessions apart; CORS is what decides whose pages may
 * read the responses — and both APIs were configured with
 * `https://*.meetifyy.app`, which covers every subdomain of every environment,
 * and development also listed production's apex outright. Each API therefore
 * answered the other environment's frontend and admin with credentialed
 * responses. Nothing checked, because the only CORS rule here was "no `*`".
 *
 * Scoped to hosts under the shared cookie domain, because that is where two
 * environments can meet: a host-only deployment (a developer's machine) sets
 * no `COOKIE_DOMAIN` and is never examined, and an origin elsewhere — the
 * installed app's `https://localhost` — belongs to no environment.
 *
 * A pattern is judged by what it can match, not by how it is spelled: its
 * wildcard is filled in with a host of each kind, and any result under the
 * shared domain that belongs to another environment condemns it.
 */
function corsIsolationProblems(): string[] {
  const domain = (authConfigValues.cookie.domain ?? '')
    .replace(/^\./, '')
    .toLowerCase();
  if (!domain) return [];

  const underSharedDomain = (host: string) =>
    host === domain || host.endsWith(`.${domain}`);
  const foreign = (host: string) =>
    Boolean(host) &&
    underSharedDomain(host) &&
    !hostBelongsToThisEnvironment(host);

  const problems: string[] = [];
  const entries = [
    ...appConfigValues.cors.origins.map((origin) => ({
      origin,
      pattern: false,
    })),
    ...appConfigValues.cors.originPatterns.map((origin) => ({
      origin,
      pattern: true,
    })),
  ];

  for (const { origin, pattern } of entries) {
    if (origin === '*') continue; // reported by the wildcard check below
    if (origin.includes('*')) {
      const reachable = WILDCARD_PROBES.map((label) =>
        hostOf(origin.replace(/\*/g, label)),
      ).filter(foreign);
      if (reachable.length > 0) {
        problems.push(
          `CORS ${pattern ? 'pattern' : 'entry'} "${origin}" also matches ` +
            `${reachable.map((h) => `"${h}"`).join(', ')}, which belong to ` +
            `another environment under "${domain}". List this ` +
            `environment's exact origins instead.`,
        );
      }
      continue;
    }
    const host = hostOf(origin);
    if (foreign(host)) {
      problems.push(
        `CORS allows "${origin}", which belongs to another environment under ` +
          `"${domain}". Remove it from CORS_ORIGINS / FRONTEND_URL / ADMIN_URL.`,
      );
    }
  }
  return problems;
}

export function assertEnvironmentIsolation(): void {
  // Tests run in no browser and serve no page, and build their configuration
  // per case.
  if (IS_TEST) return;

  if (!IS_PRODUCTION && !IS_STAGING) {
    // Development: only the CORS check applies. Its resources are allowed to
    // be named anything, but its API must not answer production's pages.
    if (process.env.DEV_RESOURCE_CHECK_DISABLED === 'true') return;
    return throwIfProblems(corsIsolationProblems());
  }

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

  problems.push(...corsIsolationProblems());

  throwIfProblems(problems);
}

function throwIfProblems(problems: string[]): void {
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
