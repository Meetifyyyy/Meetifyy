# Architecture and technical stack

How the pieces of Meetifyy fit together, what each is built with, and the
boundaries the code enforces.

Related: [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md),
[BACKEND_AND_API.md](BACKEND_AND_API.md), [DATABASE.md](DATABASE.md),
[INFRASTRUCTURE.md](INFRASTRUCTURE.md), [MOBILE_APP.md](MOBILE_APP.md).

---

## 1. System overview

```
                 ┌──────────────── Vercel ────────────────┐
 browser ───────▶│ frontend (React 18 PWA)   admin-frontend│◀── admin (Cloudflare Access)
                 └───────────┬────────────────────┬────────┘
 Android app ──(WebView, https://localhost)        │
     │                       │ HTTPS + Socket.IO   │ HTTPS (admin JWT cookies)
     ▼                       ▼                     ▼
 ┌──────────────── Azure Container Apps ──────────────────────────┐
 │ backend (NestJS 11)  ──▶ Redis (BullMQ queues, rate limits)     │
 │      │   └─ migration job (prisma migrate deploy, pre-deploy)   │
 └──────┼──────────────────────────────────────────────────────────┘
        ├──▶ Supabase Postgres (Prisma, adapter-pg)   Supabase Auth (JWKS)
        ├──▶ Cloudflare R2 (public media, private verification/chat media)
        ├──▶ Resend (email) ─fallback─▶ Brevo SMTP    Firebase FCM / Web Push (push)
        └──▶ Sentry (errors, traces)
```

- Clients talk **only** to the backend. The admin console holds no Supabase
  credentials; the student frontends use Supabase only for the signup
  `verifyOtp` step. The Supabase Data API is locked down
  ([DATABASE.md](DATABASE.md#3-supabase-data-api-postgrest)).
- Media bytes go **directly** from clients to R2 by presigned PUT, with a
  backend pass-through fallback.
- Realtime (presence, messaging, typing, Instant Match) runs over Socket.IO on
  the same backend.
- Background work (email, notifications, push, account deletion, Instant
  Match, ranking) runs in BullMQ workers inside the backend process.

## 2. Applications

| | What it is | Stack | Deployed to |
|---|---|---|---|
| `backend/` | API, queues, realtime | NestJS 11, Node ≥ 22, TypeScript | Azure Container Apps |
| `frontend/` | Student web app (PWA) **and** the source of the installed Android app | React 18, Vite 6, JavaScript (+ typed contracts) | Vercel; APK built locally |
| `admin-frontend/` | Admin portal | React 19, Vite 8, TypeScript 6 | Vercel |

The two frontends deliberately differ. `frontend` is JavaScript and carries the
PWA, offline and realtime surface; `admin-frontend` is TypeScript, has no
Supabase credentials at all, and talks only to the backend using admin JWTs —
so a compromised admin bundle exposes no database access.

## 3. Technical stack

Versions are the declared ranges in each `package.json` at the time of
writing; check `package.json` if this drifts.

### Backend (`backend/package.json`)

| Area | Technology |
|---|---|
| Framework | NestJS 11 (`@nestjs/*`), Express, `@nestjs/platform-socket.io` |
| Database | Prisma 6 with `@prisma/adapter-pg` (node-postgres `pg` 8) — queries do not go through Prisma's Rust engine |
| Queues | BullMQ 5 on Redis (ioredis) |
| Realtime | Socket.IO 4 |
| Auth | `@supabase/supabase-js` 2; user JWTs verified locally against the project's JWKS |
| Storage | AWS SDK v3 S3 client pointed at Cloudflare R2; `sharp` for images |
| Email | Resend 6 (primary), nodemailer SMTP to Brevo (failover) / Mailpit (local); templates as React Email components (`@react-email/components`, `@react-email/render`, React 19) |
| Push | `web-push` (VAPID), `firebase-admin` (FCM) |
| Rate limiting | `rate-limiter-flexible` 11 |
| Monitoring | `@sentry/nestjs` 10 (+ `@sentry/profiling-node`) |
| Security headers | Helmet 8 |
| Tests / lint | Jest 30, ESLint 9 (blocking, zero warnings), TypeScript 5.7 |

### Frontend (`frontend/package.json`)

| Area | Technology |
|---|---|
| UI | React 18.3, React Router 7, Framer Motion (web only) |
| Data | TanStack Query 5, Zustand 5 |
| Build | Vite 6, `vite-plugin-pwa` (web build only) |
| Realtime | `socket.io-client` |
| Auth | `@supabase/auth-js` 2 (signup `verifyOtp` only; lazy in the app) |
| Native | Capacitor 8.5 (`core`, `android`, `ios`), `@capacitor/push-notifications` 8.1, `@aparajita/capacitor-secure-storage` 8 |
| Monitoring | `@sentry/react` 10 (web), `@sentry/capacitor` 4 (app), `@sentry/vite-plugin` |
| Tests / lint | Vitest 4, ESLint 9 (boundary rules blocking), `tsc` typecheck for contract files |

### Admin frontend (`admin-frontend/package.json`)

React 19, Vite 8, TypeScript 6, React Router 7, TanStack Query 5, Recharts 3,
Framer Motion. Linted with **Oxlint** (`npm run lint`).

### Managed services

See [INFRASTRUCTURE.md](INFRASTRUCTURE.md#2-hosting-and-managed-services):
Supabase (Postgres + Auth), Cloudflare R2 + DNS + Access, Resend, Azure
Container Apps (API, Redis, migration job), Vercel, Sentry, Firebase.

## 4. Backend architecture

Domain modules under `backend/src/` (see
[BACKEND_AND_API.md](BACKEND_AND_API.md#1-layout)), with cross-cutting pieces
in `common/` (guards, decorators, rate limiting, campus and verification
gating), `config/` (the only reader of `process.env`, plus the isolation
guard) and `observability/`.

Request path for an authenticated HTTP call:

1. Helmet, CORS (exact-origin allowlist), cookie parsing.
2. Global rate-limit tier (`ratelimit.guard.ts`): per user when a verified JWT
   is present, per IP otherwise.
3. `JwtGuard`: token from the HttpOnly cookie (web) or `Authorization` +
   `x-session-id` (app); local JWKS verification; session liveness/ownership,
   account status and legal-acknowledgement lookups started concurrently and
   judged in a fixed order; CSRF double-submit for cookie-authenticated
   mutations.
4. Route guards: `@VerifiedOnly`, campus affiliation, `RateLimitPolicyGuard`
   policies.
5. `ValidationPipe` (class-validator DTOs, whitelist + forbid unknown).
6. Service → Prisma; side effects enqueued to BullMQ; socket emits.
7. `HttpExceptionFilter` shapes errors and reports 5xx to Sentry.

Startup: `instrument.ts` (Sentry) is imported first; `env.ts` validates the
whole configuration; the isolation guard checks resource names; Prisma warms
the pool. Shutdown closes queue workers before the database.

## 5. Frontend architecture

```
frontend/src/
├── core/          portable, platform-free code (api transport + endpoints, navigation intents, theme, version)
├── platform/
│   ├── contracts.ts   typed interfaces: SessionSource, SecureStorage, SyncKeyValueStore, ApiOrigin, AppLifecycle, PushService …
│   ├── web/           browser implementations (cookie session source, storage, apiOrigin, push, Sentry boot)
│   └── capacitor/     native implementations (secure storage, session source, apiOrigin, push, deep links, system bars …)
├── mobile/        the app's entry (main.jsx), launch readiness, system bars, feed snapshot, update gate, Supabase facade
├── features/      auth, campus, campus-events, communities, confessions, crew, feed, info, instant-match,
│                  messages, notifications, profile, search, settings
├── layout/        shells, headers, sidebars, bottom nav
├── shared/        components, hooks, stores, api assembly (apiClient.js), push worker logic, Sentry options/scrub
├── config/        build-time public config (IS_DEV_BUILD, IS_MOBILE_BUILD …)
├── styles/        tokens and the typography system (styles/README-typography.md)
├── __perf__/      render-cost harness (__perf__/README.md)
├── main.jsx       web entry          sw.js   service worker (web production only)
```

Two builds come from this tree: `vite.config.js` (website, entry `main.jsx`,
PWA) and `vite.mobile.config.js` (installed app, entry `mobile/main.jsx`, no
service worker). Both mount the same `App`.

### The core / platform boundary

`core/` is written so a second client can reuse it:

- `core/api/transport.js` is a **factory**; `shared/api/apiClient.js` is the
  composition root that assembles it with a session source, storage, API
  origin and hooks. `core/api/endpoints.js` builds the endpoint namespaces over
  an injected transport. Two transports are independent (separate origins,
  CSRF tokens, failover flags, store purges) — a test pins that.
- The transport reports error codes through `TransportHooks.onApiErrorCode`;
  the app decides what legal-consent or account-status codes mean.
- ETags live in `core/api/etagCache.js` over an injected synchronous store
  (a native implementation needs an in-memory cache hydrated at boot rather
  than a bridge call per request).
- Route policy (`PUBLIC_PATHS`, `BEARER_PATHS`, `SAFE_METHODS`) and media URL
  helpers live in `core/api/paths.js` and `core/api/media.js`.

ESLint enforces the boundary (blocking in CI as
`npx eslint src/core src/platform --max-warnings 0`):

| In `core/`, forbidden | Rule |
|---|---|
| `@config`, `@shared/*`, `../shared/*` imports | `no-restricted-imports` |
| `@capacitor/*` | `no-restricted-imports` |
| `react` | `no-restricted-imports` |
| `window`, `document`, `localStorage`, `navigator` | `no-restricted-globals` |
| `import.meta.env` | `no-restricted-syntax` |

`@capacitor` imports are allowed only under `platform/capacitor/`; the mobile
root must not import the web root and vice versa. A later block with the same
rule key replaces an earlier one in ESLint flat config, so the specific
`core/` block must come last. `platform/contracts.ts` and other typed files
are checked by `npm run typecheck` (`strict`, `noUncheckedIndexedAccess`).

Deleting `src/mobile/`, `src/platform/capacitor/`, `index.mobile.html` and
`vite.mobile.config.js` still leaves a web app that builds and passes its tests
(verified once as an independence experiment).

### Client state rules

- Server state lives in TanStack Query. On sign-out and account switch,
  `resetClientStateForNewUser` clears the query cache, ETags and
  session-scoped storage.
- React Query never retries a 4xx (a retried 429 spends another point).
- `UsersMapProvider` keeps entry identity stable unless a user actually
  changes — it is read by every `RichText` and `MessageBubble`, and churn there
  re-renders every post body and chat bubble.
- Read store slices with selectors (`useGlobalSocketStore(selector)`), not the
  whole store.

## 6. Key flows

| Flow | Where it is described |
|---|---|
| Sign-in, sessions, refresh, mobile bearer sessions | [SECURITY.md](SECURITY.md#2-sessions) |
| Signup handover (`verifyOtp` → profile → `session/adopt`) | [SECURITY.md](SECURITY.md#4-auth-invariants) |
| Campus affiliation and college email | [FEATURES_AND_FLOWS.md](FEATURES_AND_FLOWS.md#1-signup-campus-and-college-email) |
| Email changes and reauthentication | [SECURITY.md](SECURITY.md#8-email-change-security) |
| Notifications and push delivery | [FEATURES_AND_FLOWS.md](FEATURES_AND_FLOWS.md#2-push-notifications) |
| Media upload | [BACKEND_AND_API.md](BACKEND_AND_API.md#5-uploads-and-media) |
| Email delivery (backend vs Supabase Auth) | [INFRASTRUCTURE.md](INFRASTRUCTURE.md#email) |
| Deploy | [INFRASTRUCTURE.md](INFRASTRUCTURE.md#4-cicd-and-the-deploy-pipeline) |
| App startup | [MOBILE_APP.md](MOBILE_APP.md#3-auth-and-lifecycle-on-the-device) |
