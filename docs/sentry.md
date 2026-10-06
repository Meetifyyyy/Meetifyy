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

### Website and app (`frontend/.env*`, Vercel project env vars)

| Variable | Purpose |
|---|---|
| `VITE_SENTRY_DSN` | `meetifyy-web` DSN — read by website builds only. Public by design. Empty = off. |
| `VITE_SENTRY_ANDROID_DSN` | `meetifyy-android` DSN — read by APK builds only. Separate name so one env file (`.env` serves both `npm run dev` and debug APKs) cannot send one app's errors into the other's project. |
| `VITE_SENTRY_ENABLED` | `false` keeps Sentry off. Default true. |
| `VITE_SENTRY_ENVIRONMENT` | Optional cross-check; must equal `VITE_APP_ENV`. |
| `VITE_SENTRY_TRACES_SAMPLE_RATE` | Default 0.05 production / 1.0 elsewhere. |
| `VITE_SENTRY_PROPAGATE_TRACES` | Join browser and API traces. Default false; see "Trace propagation". |

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

## Android app

- `src/platform/capacitor/sentry.js` runs first in `src/mobile/main.jsx`.
  `@sentry/capacitor` starts both the JS SDK (WebView errors) and the native
  Android SDK (Java/Kotlin crashes, NDK crashes, ANRs, app-lifecycle and
  network breadcrumbs, device model and OS version). `cap sync` adds the
  `:sentry-capacitor` Gradle module (`capacitor.settings.gradle`,
  `app/capacitor.build.gradle`).
- Native crashes are written to disk and sent on the next launch.
- The release is `meetifyy-android@<versionName>+<commit>`: `versionName` in
  `android/app/build.gradle` is a hand-edited "1.0", so the commit is what
  distinguishes builds. Bump `versionName` for store releases as usual.
- Debug APK (`npm run mobile:apk`) builds in development mode and reads
  `frontend/.env`; release (`npm run mobile:apk:release`) reads
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
- Health probes are not traced.
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

## Disabling locally

Leave the DSN empty (the default in every `.env.example`), or set
`SENTRY_ENABLED=false` / `VITE_SENTRY_ENABLED=false`. Dev builds log one line,
`[sentry] disabled: <reason>`, and nothing else changes.

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
