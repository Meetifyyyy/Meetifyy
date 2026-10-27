# Sentry

Error and performance monitoring for the three Meetifyy applications. Every
piece is environment-controlled, nothing is hardcoded, and a missing or empty
configuration simply leaves Sentry off: every app starts and runs normally
without it.

## Structure

One Sentry **project per application**; **environments** separate development
from production inside each project; every build reports a **release**.

Development lives in the Sentry org **`meetifyy-dev`** (US region), projects
`meetifyy-api`, `meetifyy-web`, `meetifyy-android`. Production should get its
own org (like the separate Azure, Cloudflare and Supabase accounts), with the
same three project names and its own DSNs and auth token.

| Application | Sentry project (suggested slug) | Environments | Release |
|---|---|---|---|
| Website (Vite + React) | `meetifyy-web` | `development`, `production` | `meetifyy-web@<commit>` |
| Android app (Capacitor 8) | `meetifyy-android` | `development`, `production` | `meetifyy-android@<versionName>+<commit12>` |
| API (NestJS) | `meetifyy-api` | `development`, `production` | `meetifyy-api@<commit>` |

The website is **not** Next.js. It is Vite 6 + React 18, so it uses
`@sentry/react`; the app uses `@sentry/capacitor` (which wraps `@sentry/react`
and adds the native Android SDK); the API uses `@sentry/nestjs`.

## How development and production stay apart

- **The environment is never a free setting.** Each app tags events with the
  environment it already uses for everything else: `VITE_APP_ENV` (website,
  app) and `APP_ENV` (API). A development build cannot report as production.
- **The DSN comes from the deployment's own configuration**: the Vercel
  project's env vars (website), the APK's env file (`.env` for debug,
  `.env.production` for release), the Container App's `sentry-dsn` secret
  (API). Development and production are separate Vercel projects, separate env
  files and separate Container Apps in separate Azure subscriptions.
- **Cross-checks that turn Sentry off rather than send to the wrong place**:
  - `SENTRY_ENVIRONMENT` / `VITE_SENTRY_ENVIRONMENT`, if set, must equal the
    app's environment. Set them in each environment's config (the examples do)
    and a production DSN pasted into a development deployment, or the reverse,
    leaves Sentry off instead of mixing data.
  - The website also refuses a production build on a non-production host
    (dev.meetifyy.app, previews) and a non-production build on meetifyy.app.
- **CI secrets are environment-scoped**: the deploy workflows read Sentry's
  token, org and project from the `development` / `production` GitHub
  Environments, exactly like the Azure credentials, so the dev workflow can
  only ever write to the dev configuration.

## Environment variables

### API (`backend/.env*`, Container App env/secrets)

| Variable | Purpose |
|---|---|
| `SENTRY_DSN` | `meetifyy-api` DSN for this environment. Empty = off. Secret on the Container App. |
| `SENTRY_ENABLED` | `false` keeps Sentry off even with a DSN. Default true. |
| `SENTRY_ENVIRONMENT` | Optional cross-check; must equal `APP_ENV` or Sentry stays off. |
| `SENTRY_RELEASE` | Optional override. Default `meetifyy-api@$GIT_COMMIT_SHA`. |
| `GIT_COMMIT_SHA` | Set by the deploy workflows on every rollout. |
| `SENTRY_TRACES_SAMPLE_RATE` | Default 0.1 production / 1.0 elsewhere. |
| `SENTRY_PROFILES_SAMPLE_RATE` | Default 0.05 production / 1.0 elsewhere. |
| `SENTRY_REPORT_LOCAL` | `true` lets a local run report. Default false outside production: a run with no `GIT_COMMIT_SHA` (a laptop) stays off, so it cannot file issues into the deployed development API's project. |

### Website and app (`frontend/.env*`, Vercel project env vars)

| Variable | Purpose |
|---|---|
| `VITE_SENTRY_DSN` | `meetifyy-web` DSN — read by website builds only. Public by design. Empty = off. |
| `VITE_SENTRY_ANDROID_DSN` | `meetifyy-android` DSN — read by APK builds only. Separate name so one env file (`.env` serves both `npm run dev` and debug APKs) cannot send one app's errors into the other's project. |
| `VITE_SENTRY_ENABLED` | `false` keeps Sentry off. Default true. |
| `VITE_SENTRY_ENVIRONMENT` | Optional cross-check; must equal `VITE_APP_ENV`. |
| `VITE_SENTRY_TRACES_SAMPLE_RATE` | Default 0.05 production / 1.0 elsewhere. |
| `VITE_SENTRY_PROPAGATE_TRACES` | Join browser and API traces. Default false; see "Trace propagation". |
| `VITE_SENTRY_REPORT_DEV_SERVER` | `true` lets pages served by Vite's dev server report (`npm run dev`, live-reload APKs). Default false. |

Build-time only (source maps). These are **not** `VITE_` variables, so Vite
never exposes them to client code:

| Variable | Where |
|---|---|
| `SENTRY_AUTH_TOKEN` | Vercel project (website), your shell (APK builds), GitHub Environment secret (API). Org token, `project:releases` scope. |
| `SENTRY_ORG` | Same places (GitHub: Environment *variable*). |
| `SENTRY_PROJECT_WEB` | Vercel project: `meetifyy-web`. |
| `SENTRY_PROJECT_ANDROID` | Shell, for APK builds: `meetifyy-android`. |
| `SENTRY_PROJECT_API` | GitHub Environment variable: `meetifyy-api`. |

## Website

- `src/platform/web/sentryBoot.js` runs first in `src/main.jsx`. It decides,
  synchronously and cheaply, whether Sentry runs (`shared/lib/sentryOptions.js`).
- If it does, the SDK (`src/platform/web/sentry.js`, a separate ~51 KB gzip
  chunk) is loaded **after first paint**, when the browser is idle. Errors and
  breadcrumbs from before then are held by the monitoring facade and replayed.
  The entry chunk grew by about 2.8 KB gzip, not 50.
- Captures: uncaught errors, unhandled rejections, render crashes caught by
  the error boundaries (`RouteErrorBoundary`, `RootErrorBoundary` — users
  still see the same friendly screens), page-load/navigation performance.
- CSP: both `vercel.json` files allow `https://*.ingest.sentry.io`,
  `*.ingest.us.sentry.io` and `*.ingest.de.sentry.io` in `connect-src`.
- **Tunnel.** On dev.meetifyy.app, meetifyy.app and www.meetifyy.app the SDK
  sends to `/api/app-events` on the site itself (`tunnel` in
  `shared/lib/sentryOptions.js`), and a host-conditional rewrite in both
  `vercel.json` files forwards it to that environment's ingest URL. Ad and
  tracker blockers block `*.ingest.sentry.io` outright — the dev site's console
  showed every envelope failing with `net::ERR_BLOCKED_BY_CLIENT` — so without
  this, the browsers most likely to hit a bug were the ones that never reported
  it. Each rewrite's destination is one fixed project URL, so the tunnel can
  only ever deliver into that environment's project.
  - **The rewrite's destination must be the same project as that host's
    `VITE_SENTRY_DSN`.** dev.meetifyy.app → the `meetifyy-dev` org's web
    project; meetifyy.app and www → the `meetifyy` org's. Changing a DSN means
    changing its rewrite in both `vercel.json` files, in the same commit.
  - Other hosts (Vercel previews, localhost) have no rewrite and send direct.
  - The app (APK) never tunnels: its page is `https://localhost` inside the
    WebView, which no blocker list targets.
- **Dev server.** Pages served by Vite's dev server do not report unless
  `VITE_SENTRY_REPORT_DEV_SERVER=true`. Hot-reload errors from a half-saved
  edit (React Refresh hook-order errors, `X is not defined`, chunk fetches from
  `localhost:3001/src/...`) are not app errors and cannot happen in a build.
- **Cloudflare Access (dev.meetifyy.app only).** When the Access session has
  expired, every same-origin request is redirected to the Access login page.
  The launch-time version gate in `index.html` fetches `/version.json` with
  `redirect: 'manual'`, so it sees an `opaqueredirect` instead of following the
  redirect into a CSP violation and a CORS failure, and reloads the page once
  per tab session, which takes the browser through Access properly.
- **Deploy skew.** Each deploy removes the previous build's chunks, so a tab
  open across a deploy fails its next lazy import ("Failed to fetch dynamically
  imported module", MEETIFYY-WEB-1). `staleChunkRecovery.js` reloads once per
  minute and the tab comes back on the new build; the error is still reported,
  on purpose, so the rate stays visible. Vercel's Skew Protection would keep
  the old chunks reachable instead, and is a plan-level setting.

## Android app

- Two halves, like the website's. `src/platform/capacitor/sentryBoot.js` runs
  first in `src/mobile/main.jsx` and is tiny: it decides whether Sentry is on,
  holds every report made through `shared/lib/monitoring` and every uncaught
  error and unhandled rejection from then on. The SDK,
  `src/platform/capacitor/sentry.js`, is its own chunk (~170 KB), imported
  once the first screen is fully drawn and the page is idle (or 6 s after
  boot); it starts, waits for the JavaScript client to exist (`@sentry/capacitor`
  creates it only after the native SDK has initialised), then receives
  everything held.
  `@sentry/capacitor` starts both the JS SDK (WebView errors) and the native
  Android SDK (Java/Kotlin crashes, NDK crashes, ANRs, app-lifecycle and
  network breadcrumbs, device model and OS version). `cap sync` adds the
  `:sentry-capacitor` Gradle module (`capacitor.settings.gradle`,
  `app/capacitor.build.gradle`).
- **Why it is not started at boot (2026-10-26):** the SDK was ~22% of the
  entry chunk (759.7 KB → 590.5 KB without it, production build), which the
  WebView compiles from scratch on every cold start (a bundled app gets no V8
  code cache), and its native init ran on Capacitor's single plugin thread
  ahead of the Keystore reads that decide who is signed in (~360 ms traced on
  the I2208). **Coverage trade-off, deliberately accepted:** JavaScript errors
  from boot onward are held and delivered (better than before: the JS SDK used
  to start only after the native init, so early JS errors were lost), but
  native Java/NDK crashes are only caught from the SDK's start, a second or two
  into a cold start, instead of ~1 s. Verified on the I2208: an error thrown
  1.3 s into boot, before the chunk loaded, reached `meetifyy-android` (dev).
- Integrations (audited 2026-10-26): the @sentry/capacitor defaults are all
  error reporting (global handlers, breadcrumbs, linked errors, dedupe, event
  filters, release/device context, frame rewriting). Tracing
  (`browserTracingIntegration`) is added only when the sample rate is above 0
  (production 0.05, development 1.0). Replay, feedback and profiling are not
  in the bundle.
- Native crashes are written to disk and sent on the next launch.
- The release is `meetifyy-android@<versionName>+<commit>`: `versionName` in
  `android/app/build.gradle` is a hand-edited "1.0", so the commit is what
  distinguishes builds. Bump `versionName` for store releases as usual.
- Debug APK (`npm run mobile:apk`) builds in development mode and reads
  `frontend/.env.development`; release (`npm run mobile:apk:release`) reads
  `.env.production`. Put the matching `meetifyy-android` DSN in each, as
  `VITE_SENTRY_ANDROID_DSN`.
- Android minification is off (`minifyEnabled false`), so there is no
  ProGuard mapping to upload. The app's JavaScript maps are uploaded by the
  Vite plugin when the build has `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and
  `SENTRY_PROJECT_ANDROID`, then deleted from `dist-mobile` so they never ship
  inside the APK.
- **Debug APKs** (`npm run mobile:apk`) take any of those not exported from
  `~/.sentryclirc` (written by `sentry-cli login`, or by hand with `[auth]
  token=` and `[defaults] org=`/`project=`, mode 600). That file holds a
  DEVELOPMENT-org token, so **release APKs never read it**: for
  `mobile:apk:release` export the production org's values explicitly.
  `scripts/build-apk.mjs` prints which org/project it will upload to.
- Session Replay is not enabled anywhere (both rates are 0).

## API

- `src/instrument.ts` is imported as the first line of `main.ts`, before
  express, Prisma or any module loads, which is what lets request and database
  tracing attach.
- Reported: every **5xx** from `HttpExceptionFilter` (the existing global
  filter; it still logs, records to the error log and answers the client with
  the same safe body, e.g. `"Internal server error"`), tagged `route`,
  `http.method`, `http.status_code`, `request_id`, `feature` and the internal
  user id. 4xx are expected outcomes and are not sent. Uncaught exceptions and
  unhandled rejections outside requests come from the SDK's global handlers.
- Health probes are not traced, and neither is the database warm-up and
  25-second keep-alive (`PrismaService.pingPool`, wrapped in
  `suppressTracing`). Those `SELECT 1`s run outside any request, so each one
  was a root transaction, filed as "Slow DB Query" (MEETIFYY-API-2) whenever
  the pooler answered slowly.
- **Only units of work start a trace.** A request, a queue job, and each
  piece of background work traced by `traceBackground`
  (`observability/background-trace.ts`). Everything inside one of those is
  its child and is kept with it.
  - **The rule** (`observability/trace-sampler.ts`, consulted only for a span
    with no parent): a database or cache call never starts a trace (Redis,
    Postgres, any `prisma:*` span), and neither does a Nest guard, interceptor
    or middleware (`middleware.nestjs`). On their own they are fragments.
    Before this, in ten hours of the dev API, BullMQ's own Redis polling
    produced about 121,000 spans and timers and sockets about 4,700
    single-query traces, each its own trace. These are Sentry's estimates of
    what the API produced: Explore extrapolates `count()` by the sample rate,
    and at the dev API's 20% it stored a fifth (`count_sample()`).
  - **Background units**, one named transaction each, its queries inside:
    - timers: `task activities.lifecycle-sweep` (every 60 s, 5%),
      `task realtime.revoked-session-sweep` (60 s, 5%),
      `task messages.instant-match-chat-cleanup` (5 min, 10%), the 6-hourly
      retention sweeps, the slow-request and error-log flushes (only when
      there is something to write), and the BullMQ fallback sweeps;
    - socket events: `ws <event>` via `SocketTraceInterceptor` on the
      gateway, plus `ws connect` / `ws disconnect`. Frequent ones are capped
      in `SOCKET_TRACE_RATES` (heartbeat and typing 1%, receipts 5%); `ping`
      is not traced;
    - pub/sub: the two domain events that do I/O
      (`pubsub user.settings_updated`, `pubsub activity.visibilityChanged`).
      The other listeners only clear in-memory caches, so there is nothing to
      trace.
    Each unit starts a NEW trace, so a timer armed during boot does not run
    every tick inside the boot trace (whose spans would later arrive as
    orphans).
  - The Instant Match expiry sweep (every 10 s) is sampled at 1%: about 86
    traces a day instead of about 1,700 at the dev API's 20% (an estimated
    150,000 spans produced in the same ten hours).
  - A rate a unit declares is an upper bound; the environment's
    `SENTRY_TRACES_SAMPLE_RATE` still caps it. Everything else uses that rate,
    or follows the browser's decision when the trace continues one.
  - Errors are not sampled by this; they are always sent.
  - New background work: wrap it in `traceBackground`, or its queries will not
    be traced at all (they are dropped as fragments, not mis-traced).
  - Checked on real Postgres (PGlite) and real Redis + BullMQ, Node 22
    context semantics: 388 transactions before, 22 after, every one a request
    or a unit with its database and Redis spans inside. Through a real Nest
    gateway and socket.io client, acks, `{event, data}` replies and
    `WsException` errors behave exactly as before. About 25 ns per sampling
    decision; with BullMQ idle, the API's CPU time fell from 356 to 267 ms a
    minute (184 ms without Sentry).
- **No node-postgres integration.** Database spans come from Prisma's own
  instrumentation. Prisma's engine calls the pg adapter from native code, so
  on Node 22 every pg span inherits the context the engine was loaded in —
  the boot trace — and once that trace has been sent each one goes out as a
  root transaction of its own ("pg-pool.connect", "SELECT 1"), whatever the
  sample rate. `instrument.ts` filters the `Postgres` integration out; nothing
  else uses `pg` directly. Reproduced on a real Postgres with
  `node --no-async-context-frame` (Node 22's context behaviour on Node 24).
- **Shutdown order.** Queue processors extend `DrainingWorkerHost`, which
  closes the BullMQ worker in `beforeApplicationShutdown`; `PrismaService`
  disconnects in `onApplicationShutdown`, after it. Before, the database closed
  first and workers kept running jobs against it, which surfaced as unrelated
  crashes (MEETIFYY-API-C, -G). A query issued after the database has closed
  now throws `DatabaseUnavailableError` instead of resolving to `undefined`,
  and transient connection drops (P1001/P1017, "Connection terminated
  unexpectedly") are retried twice (`connection-retry.middleware.ts`).
- Source maps: the Dockerfile stamps `dist/` with debug IDs (offline); the
  deploy workflow copies `dist/` out of the built image and uploads it, so
  stack traces resolve to the original `.ts` lines.

## Privacy

Enforced in code, in two layers, on every platform:

1. **What the SDK collects** — `sendDefaultPii: false`; on the API the
   `dataCollection` block in `instrument.ts` turns off cookies, request bodies,
   IP headers, DB query data and stack-frame local variables (the refresh token
   lives in one). Replay is off.
2. **What leaves the process** — `beforeSend`/`beforeSendTransaction`/
   `beforeBreadcrumb` scrub every event (`backend/src/observability/sentry-scrub.ts`,
   `frontend/src/shared/lib/sentryScrub.js`):
   - cookies and request bodies removed; `Authorization`, cookie, CSRF and
     any token/secret/session-like headers dropped;
   - query strings: token-like values filtered on the API; **every** value
     filtered on the client (search terms are user input);
   - user reduced to `{ id }` — the internal id, never email, name or IP;
   - keys like `password`, `token`, `refresh`, `email`, `phone`, `text`,
     `content` redacted anywhere in extra, contexts, breadcrumbs and spans;
   - console breadcrumbs dropped on the client (logs can carry message text).

The user is set on sign-in and cleared synchronously on sign-out
(`AuthContext`), with an effect on the account id as a backstop, so one
account's id never follows the next session. Before sign-in, the native SDK
uses its own random installation id.

## Breadcrumbs

What happened before an error, without content: navigation (from/to paths),
each failed API call (`POST /api/posts/:id/like → 500`, from the transport's
`onApiFailure` hook), sign-in/sign-out, and on Android app lifecycle,
connectivity and system events.

## Releases and CI

- **API**: `deploy-dev.yml` / `deploy-prod.yml` create `meetifyy-api@<sha>`,
  associate the commit, upload the image's source maps, and after the health
  check passes finalize the release and record a deploy to `development` /
  `production`. Skipped (with a log line) when the environment has no
  `SENTRY_AUTH_TOKEN`.
- **Website**: built by Vercel. With `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and
  `SENTRY_PROJECT_WEB` in the Vercel project, the build uploads maps under
  `meetifyy-web@<VERCEL_GIT_COMMIT_SHA>`, records a deploy for `VITE_APP_ENV`,
  and deletes the maps from the deployed output.
- **App**: built locally (`scripts/build-apk.mjs`); same plugin, using the
  shell's variables and `SENTRY_PROJECT_ANDROID`.

"Did this error start after a deployment?" — open the issue's *First seen*
release, or the project's Releases page, which lists each deploy per
environment.

## Trace propagation

The API accepts `sentry-trace` and `baggage` (CORS `allowedHeaders` in
`main.ts`). Clients only send them with `VITE_SENTRY_PROPAGATE_TRACES=true`,
which must not be switched on until that API is deployed in the environment:
a preflight that rejects a header fails the whole request, and Vercel ships the
website minutes before the API deploy completes.

## Quota

Spans (traces) and errors are metered separately. On 2026-10-27 the
development org ran out of span quota (`span_usage_exceeded`): from then on
every trace was refused with a 429 until the quota resets or is raised, while
errors kept arriving. The SDKs honour the 429's retry-after and stop sending
for that window, so the app itself is not slowed; a browser still logs the
refused request in its console. Find dropped volume and its reason with the
Sentry connector's `find_dropped_events`, or Stats in Sentry. The causes were
background noise, all fixed in the API: the database keep-alive, orphaned
node-postgres spans, BullMQ's Redis polling and the 10-second sweep (see API).

## Disabling locally

Leave the DSN empty (the default in every `.env.example`), or set
`SENTRY_ENABLED=false` / `VITE_SENTRY_ENABLED=false`. Dev builds log one line,
`[sentry] disabled: <reason>`, and nothing else changes.

Local runs are already off by default even with a DSN: the API needs
`SENTRY_REPORT_LOCAL=true` when it has no `GIT_COMMIT_SHA`, and pages from
Vite's dev server need `VITE_SENTRY_REPORT_DEV_SERVER=true`. Set the flag only
for the run that is checking Sentry, against the development DSN.

## Verifying

- **API**: deploy, then trigger a 5xx; or locally, run against the
  development DSN only. The issue shows `environment`, `release`, tags
  `route`, `http.method`, `http.status_code`, `feature`, and a stack trace in
  `.ts` once maps are uploaded. The client still receives the generic 5xx body.
- **Website**: in the browser console of the deployed site, run
  `setTimeout(() => { throw new Error('sentry check') })` (wait a few seconds
  after load for the lazy SDK). Check the project, environment and release.
- **Android**: build the debug APK with the dev DSN, open the app, then from
  `chrome://inspect` run the same snippet; for a native crash run
  `Capacitor.Plugins.SentryCapacitor.crash()` and reopen the app.

Resolve test issues afterwards.
