/**
 * Sentry for the API. Imported as the very first line of main.ts.
 *
 * WHY ITS OWN FILE, FIRST
 * The SDK instruments http, express and the database driver by hooking them as
 * they are loaded. It used to be initialised inside main.ts, but ES imports are
 * hoisted, so by the time that call ran AppModule (and with it express, Prisma
 * and every service) had already loaded, and request tracing could not attach.
 *
 * WHAT IS REPORTED
 * Errors reach Sentry from two places:
 *  - HttpExceptionFilter, for every 5xx a request produces (4xx are expected
 *    outcomes and are not sent). It keeps answering the client exactly as
 *    before; see common/filters/http-exception.filter.ts.
 *  - The SDK's own global handlers, for uncaught exceptions and unhandled
 *    rejections outside a request (cron jobs, queue workers, startup).
 *
 * DEVELOPMENT AND PRODUCTION NEVER MIX
 *  - The environment is APP_ENV, never a free-standing value. SENTRY_ENVIRONMENT
 *    exists only as a cross-check: if set and different, Sentry stays off.
 *  - The DSN is a secret on each Container App (dev and prod are separate apps
 *    in separate subscriptions), so a deployment can only send where its own
 *    secret points.
 *  - The release is meetifyy-api@<commit>, from GIT_COMMIT_SHA, which the
 *    deploy workflows set on every rollout.
 *
 * MISSING CONFIGURATION IS NOT AN ERROR
 * No DSN, SENTRY_ENABLED=false or a mismatched SENTRY_ENVIRONMENT all leave the
 * SDK uninitialised. Every Sentry.* call is then a no-op and the API starts
 * exactly as it would without it.
 *
 * See docs/sentry.md.
 */
import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import { config } from './config';
import { scrubEvent } from './observability/sentry-scrub';

const obs = config.app.observability;

function resolveRelease(): string | undefined {
  if (obs.sentryRelease) return obs.sentryRelease;
  if (obs.gitCommitSha) return `meetifyy-api@${obs.gitCommitSha}`;
  return undefined; // local runs: no release rather than a made-up one
}

/** Why Sentry is off, or null when it should start. */
export function sentryDisabledReason(): string | null {
  if (!obs.sentryEnabled) return 'SENTRY_ENABLED=false';
  if (!obs.sentryDsn) return 'no SENTRY_DSN';
  if (obs.sentryEnvironment && obs.sentryEnvironment !== config.env) {
    return `SENTRY_ENVIRONMENT (${obs.sentryEnvironment}) does not match APP_ENV (${config.env})`;
  }
  return null;
}

const disabledReason = sentryDisabledReason();

if (disabledReason) {
  // One line, and not an error: running without Sentry is a supported setup.
  if (config.env !== 'test') {
    console.info(`[sentry] disabled: ${disabledReason}`);
  }
} else {
  try {
    Sentry.init({
      dsn: obs.sentryDsn,
      environment: config.env,
      release: resolveRelease(),
      integrations: [nodeProfilingIntegration()],
      // Sampling defaults to 10% of traces and 5% of profiles in production and
      // 100% elsewhere — 1.0 in production adds measurable per-request overhead
      // and inflates Sentry costs. Both are tunable per environment.
      tracesSampleRate: obs.sentryTracesSampleRate,
      profilesSampleRate: obs.sentryProfilesSampleRate,
      initialScope: { tags: { app: 'api' } },
      // Health probes run every few seconds and say nothing about real traffic.
      ignoreTransactions: [/\/health/],
      beforeSend: (event) => scrubEvent(event),
      beforeSendTransaction: (event) => scrubEvent(event),

      /**
       * What the SDK is allowed to collect. Spelled out in full, and it has to be.
       *
       * THE BUG THIS CLOSES: Sentry attaches request cookies to spans and events,
       * filtering them by NAME against a built-in list of sensitive-looking
       * substrings (`auth`, `token`, `session`, `sid`, `csrf`, `sb-`, …). Our
       * session cookies are `mf_access` and `mf_refresh`, which match none of them.
       * `mf_sid` and `mf_csrf` were filtered — by coincidence, because they happen
       * to contain "sid" and "csrf" — while the two that actually are credentials
       * went out in the clear, on every sampled trace, as
       * `http.request.header.cookie.mf_access`. The `Authorization` header was
       * always filtered ("auth"), which is what made this easy to miss: the header
       * path looked clean while the cookie path was not.
       *
       * A live access token in a trace is a session anyone with Sentry access can
       * assume. Cookies are switched off outright rather than renamed to please a
       * deny-list, because the deny-list is not ours and the next cookie we add
       * would face the same coin toss.
       *
       * EVERY FIELD IS SET DELIBERATELY. Supplying `dataCollection` at all switches
       * the SDK's baseline from the conservative `sendDefaultPii: false` mapping to
       * its permissive DEFAULTS, where anything omitted here is turned ON — request
       * BODIES included, which is where passwords live. Omitting a field is not
       * "leave it as it was"; it is "turn it on".
       */
      dataCollection: {
        cookies: false,
        userInfo: false,
        // `true` still filters Sentry's own sensitive-key list, which is what keeps
        // `Authorization` out. The deny terms restore the IP-bearing headers that
        // the non-PII baseline dropped.
        httpHeaders: {
          request: { deny: ['forwarded', '-ip', 'remote-', 'via', '-user'] },
          response: { deny: ['forwarded', '-ip', 'remote-', 'via', '-user'] },
        },
        // Empty array = no bodies. A login body is a password.
        httpBodies: [],
        queryParams: { deny: ['forwarded', '-ip', 'remote-', 'via', '-user'] },
        genAI: { inputs: false, outputs: false },
        databaseQueryData: false,
        /**
         * Off. `localVariablesIntegration()` is in the SDK's default set, so with
         * this on, every local in a throwing frame is attached to the event — and
         * `refreshProviderSession` holds the provider refresh token in one. That is
         * the same class of exposure as the cookie leak above, reached by a
         * narrower path: it needs an exception on that particular frame.
         *
         * The cost is real — variable values are genuinely useful on a production
         * crash — so this is a judgement, not an obvious win. It goes off because a
         * session token in a bug report is not recoverable, and a stack trace
         * without locals still names the file, the function and the line.
         *
         * Turn it back on by deleting this line if the debugging cost bites;
         * `frameContextLines` and the stack itself are unaffected either way.
         */
        stackFrameVariables: false,
      },
    });
  } catch (err) {
    // A broken Sentry setup must never stop the API from starting.
    console.error('[sentry] init failed; continuing without it', err);
  }
}
