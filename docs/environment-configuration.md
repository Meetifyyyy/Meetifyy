# Environment Configuration

**The rule: environment-specific values belong in configuration, not application code.**

The same git commit is deployed to every environment. What differs is only the
environment variables it is given — the database it talks to, the domains it
generates links for, the email provider it sends through, the bucket it stores
media in, the cookies it sets, and the origins it trusts.

Moving to production is a configuration change, not a code change. There is no
search-and-replace step, no constant to flip, no branch to switch.

---

## Contents

1. [Environments](#1-environments)
2. [Where configuration lives](#2-where-configuration-lives)
3. [File layout and load order](#3-file-layout-and-load-order)
4. [Local development setup](#4-local-development-setup)
5. [Build-time vs runtime](#5-build-time-vs-runtime)
6. [Public vs private](#6-public-vs-private)
7. [Startup validation](#7-startup-validation)
8. [Variable reference](#8-variable-reference)
9. [Deploying to production](#9-deploying-to-production)
10. [Deliberately not configurable](#10-deliberately-not-configurable)

---

## 1. Environments

| Environment     | `APP_ENV`     | `NODE_ENV`   | Database | Frontend            | API                     | Email   |
| --------------- | ------------- | ------------ | -------- | ------------------- | ----------------------- | ------- |
| Local           | `development` | `development`| dev      | `localhost:3000`    | `localhost:4000`        | Mailpit |
| Test            | `test`        | `test`       | throwaway| `localhost:3000`    | `localhost:4000`        | captured|
| Preview/Staging | `staging`     | `production` | staging  | preview domain      | staging API domain      | Resend  |
| Production      | `production`  | `production` | prod     | production domain   | production API domain   | Resend  |

`APP_ENV` exists because staging must build with `NODE_ENV=production` (for
optimised builds) while still selecting staging configuration. Where `APP_ENV`
is unset it falls back to `NODE_ENV`.

```
Same git commit
      │
      ├── Development deployment  →  .env.development       →  dev DB / dev domains / Mailpit
      ├── Preview deployment      →  platform env vars      →  staging DB / preview domains
      └── Production deployment   →  platform env vars      →  prod DB / prod domains / Resend
```

---

## 2. Where configuration lives

Three apps, three configuration layers. **No application code reads
`process.env` or `import.meta.env` directly** — only the loaders below do.

### Backend — `backend/src/config/`

```
backend/src/config/
├── env.ts              # the only file that reads process.env; loads + validates
├── app.config.ts       # identity, host/port, public URLs, CORS, CSP, Sentry
├── auth.config.ts      # Supabase, admin JWT, cookies, auth redirect URLs
├── database.config.ts  # DATABASE_URL / DIRECT_URL, seed guard
├── email.config.ts     # driver, sender, SMTP / Resend
├── storage.config.ts   # provider, bucket, public URL, branding assets
├── redis.config.ts     # queue + cache connection
├── features.config.ts  # feature flags and logging behaviour
├── site.config.ts      # branding and public site links (used by emails)
├── nest-config.ts      # @nestjs/config namespaces bound to the object above
├── config.ts           # assembles every slice, then validates
└── index.ts            # public surface: `import { config } from '../config'`
```

Usage:

```ts
import { config } from '../config';

const resetUrl = config.auth.redirects.resetPasswordUrl;
const from = config.email.from;
const bucket = config.storage.r2.bucketName;
```

Never:

```ts
const url = process.env.FRONTEND_URL;              // ✗
const url = 'https://dev.meetifyy.app';            // ✗
```

`ConfigService` still works for existing injection sites — the `registerAs`
namespaces in `nest-config.ts` are views onto the same object, not a second
source of truth.

### Frontend — `frontend/src/config/`

```
frontend/src/config/
├── env.js     # the only file that reads import.meta.env; typed accessors
└── index.js   # the `config` object + the IS_DEV_BUILD constant
```

```js
import { config } from '@config';

fetch(`${config.api.baseUrl}/api/posts`);
supabase.auth.resetPasswordForEmail(email, { redirectTo: config.auth.resetPasswordUrl });
```

### Admin frontend — `admin-frontend/src/config/index.ts`

Same shape, smaller surface (`config.api.baseUrl` and app identity).

---

## 3. File layout and load order

```
.env.example                         # monorepo map (this doc is the detail)

backend/
├── .env.example                     # every backend variable, annotated
├── .env.development.example         # what differs in development
├── .env.test.example                # what differs in test
├── .env.production.example          # what differs in production
└── .env.local                       # ← yours; git-ignored

frontend/
├── .env.example
├── .env.development.example
├── .env.production.example
└── .env.local                       # ← yours; git-ignored

admin-frontend/
├── .env.example
├── .env.development.example
├── .env.production.example
└── .env.local                       # ← yours; git-ignored
```

**Only `*.example` files are committed.** `.gitignore` excludes every other
`.env*` file, so a real credential cannot be committed by accident.

**Backend load order** (first hit wins — an already-set value is never overridden):

```
process environment          ← platform/CI/shell; always wins
.env.<APP_ENV>.local         ← yours, per environment
.env.local                   ← yours
.env.<APP_ENV>               ← shared per-environment defaults
.env                         ← fallback
```

**Frontend / admin load order** (Vite's own, `<mode>` = `development` | `production`):

```
.env.<mode>.local  →  .env.local  →  .env.<mode>  →  .env
```

---

## 4. Local development setup

```bash
git clone <repo> && cd meetifyy

cp backend/.env.example        backend/.env.local
cp frontend/.env.example       frontend/.env.local
cp admin-frontend/.env.example admin-frontend/.env.local

# fill in your development credentials in each .env.local
npm install
npm run dev
```

No source file needs to be edited. Your `.env.local` files stay on your machine.

Useful local knobs:

| Variable                    | App      | Effect                                        |
| --------------------------- | -------- | --------------------------------------------- |
| `PORT`                      | backend  | API port                                      |
| `VITE_DEV_SERVER_PORT`      | frontend | dev-server port                               |
| `VITE_DEV_API_PROXY_TARGET` | frontend | where `/api` is proxied during `npm run dev`  |
| `VITE_API_LOCAL_PORT`       | both     | backend port for localhost/LAN pages          |
| `VITE_API_PREFER_LOCAL`     | both     | talk to a backend on the page's own host      |
| `DEV_EMAIL_REDIRECT`        | backend  | send all mail to one address instead          |

Testing from a phone on the same Wi-Fi works out of the box: a page served from
a LAN IP talks to the backend on that same host (`VITE_API_PREFER_LOCAL`), and
the API trusts private-network origins (`CORS_ALLOW_LOCAL_NETWORK`) — which is
forced off in production regardless of the variable.

---

## 5. Build-time vs runtime

This distinction matters and gets people every time.

| App              | When variables are read | Changing a value requires |
| ---------------- | ----------------------- | ------------------------- |
| Backend (NestJS) | **runtime**, at boot    | a restart                 |
| Frontend (Vite)  | **build time**          | a **rebuild + redeploy**  |
| Admin (Vite)     | **build time**          | a **rebuild + redeploy**  |

Vite inlines every `VITE_*` reference into the bundle when it builds. A
production bundle carries whatever values were present during the **production
build**. Editing a variable in the hosting dashboard afterwards changes nothing
until the app is rebuilt.

Consequences to respect:

- Frontend variables must be set on the deployment platform **before** the build
  runs, and set per environment (Vercel: Production / Preview / Development
  scopes). A value set only for "Development" scope will be missing from the
  production bundle.
- A frontend variable can never hold a secret, because the bundle is public.
- After changing a frontend variable, trigger a redeploy. There is no "restart".

---

## 6. Public vs private

Everything in a `VITE_*` variable ships to the browser and is readable by anyone
using the app.

**Client-safe (frontend, build-time, public):**

```
VITE_APP_ENV, VITE_APP_NAME, VITE_SITE_URL, VITE_INTERNAL_DOMAINS
VITE_API_URL, VITE_API_PROXY_PREFIX, VITE_API_LOCAL_PORT
VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY     ← anon key only, never service role
VITE_STORAGE_PUBLIC_URL
VITE_UNSPLASH_KEY, VITE_GIPHY_KEY, VITE_SENTRY_DSN, VITE_ANALYTICS_ID
VITE_ENABLE_*                                  ← feature flags
```

**Server-only (backend, runtime, secret) — must never appear in a frontend env file:**

```
DATABASE_URL, DIRECT_URL
SUPABASE_SERVICE_ROLE_KEY, SUPABASE_JWT_SECRET
ADMIN_JWT_ACCESS_SECRET, ADMIN_JWT_REFRESH_SECRET, ADMIN_JWT_PENDING_SECRET
SUPER_ADMIN_PASSWORD, SUPER_ADMIN_API_KEY
RESEND_API_KEY, SMTP_PASS
R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
```

The separation is structural, not conventional: the backend config layer is the
only thing that can read these, and it never serializes them to a response.

---

## 7. Startup validation

Both layers validate at import time and fail loudly rather than degrading.

**Backend** — one error listing every problem at once:

```
Environment configuration is invalid for APP_ENV="production".

  • Missing required environment variable: DATABASE_URL
  • Invalid FRONTEND_URL: "dev.meetifyy.app" is not a valid URL
  • Invalid COOKIE_SECURE: must be true in production
  • Invalid EMAIL_DRIVER: "mailpit" cannot be used in production

See .env.example and docs/environment-configuration.md for the full list of variables.
```

**Frontend** — the same, thrown on boot when a production build is missing a
required public value.

### Requirement tiers

| Tier                     | Variables |
| ------------------------ | --------- |
| Required in all environments | `DATABASE_URL`, `FRONTEND_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` |
| Required in staging + production | `BACKEND_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_JWT_ACCESS_SECRET`, `ADMIN_JWT_REFRESH_SECRET`, `ADMIN_JWT_PENDING_SECRET`, `EMAIL_FROM` |
| Required conditionally   | `RESEND_API_KEY` (when `EMAIL_DRIVER=resend`) |
| Development-only         | `DEV_EMAIL_REDIRECT`, `VITE_DEV_SERVER_PORT`, `VITE_DEV_API_PROXY_TARGET`, `FEATURE_DEV_ENDPOINTS` |
| Required in the browser (prod build) | `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |

### Production guardrails

These are refused rather than silently accepted, so a misconfigured production
deploy fails at boot instead of in front of users:

- `COOKIE_SECURE=false` in production.
- `COOKIE_SAME_SITE=none` without `COOKIE_SECURE=true`.
- `EMAIL_DRIVER=mailpit` in production (mail would vanish silently).
- An `http://` URL for any public URL in production.
- `EMAIL_DRIVER=resend` without `RESEND_API_KEY`.
- Destructive seeding against production without `ALLOW_DESTRUCTIVE_SEED=true`.
- Localhost/LAN CORS origins and dev endpoints in production — forced off
  regardless of what the variables say.

---

## 8. Variable reference

The annotated, authoritative lists are the example files themselves:

- [`backend/.env.example`](../backend/.env.example) — every server variable, grouped and commented
- [`frontend/.env.example`](../frontend/.env.example) — every public frontend variable
- [`admin-frontend/.env.example`](../admin-frontend/.env.example) — admin app variables

Grouped summary of what changes between environments:

| Concern        | Backend variables |
| -------------- | ----------------- |
| Domains        | `FRONTEND_URL`, `BACKEND_URL`, `API_BASE_URL`, `ADMIN_URL` |
| CORS           | `CORS_ORIGINS`, `CORS_ORIGIN_PATTERNS`, `CORS_ALLOW_LOCAL_NETWORK` |
| Security headers | `CSP_ENABLED`, `HSTS_ENABLED`, `CSP_*_SRC` |
| Cookies        | `COOKIE_DOMAIN`, `COOKIE_SECURE`, `COOKIE_SAME_SITE` |
| Database       | `DATABASE_URL`, `DIRECT_URL`, `ALLOW_DESTRUCTIVE_SEED` |
| Auth           | `SUPABASE_*`, `ADMIN_JWT_*`, `SUPER_ADMIN_*`, `AUTH_*_PATH` |
| Email          | `EMAIL_DRIVER`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, `SMTP_*`, `RESEND_API_KEY`, `DEV_EMAIL_REDIRECT` |
| Storage        | `STORAGE_PROVIDER`, `STORAGE_PUBLIC_URL`, `R2_*` |
| Queues/cache   | `REDIS_URL` (or `REDIS_HOST`/`PORT`/`PASSWORD`/`TLS`) |
| Observability  | `SENTRY_DSN`, `SENTRY_*_SAMPLE_RATE`, `LOG_LEVEL`, `LOG_PRETTY`, `LOG_QUERIES` |
| Features       | `FEATURE_DEV_ENDPOINTS`, `FEATURE_DEBUG_TOOLS`, `FEATURE_EXPERIMENTAL`, `FEATURE_RELAXED_RATE_LIMITS` |

Every auth redirect is derived, never written twice:

```
FRONTEND_URL + AUTH_RESET_PASSWORD_PATH  →  config.auth.redirects.resetPasswordUrl
FRONTEND_URL + AUTH_CALLBACK_PATH        →  config.auth.redirects.callbackUrl
BACKEND_URL  + "/api"                    →  config.app.apiBaseUrl   (unless API_BASE_URL is set)
```

---

## 9. Deploying to production

> Standing production up for the first time? Read
> **[production-setup-checklist.md](production-setup-checklist.md)** alongside
> this section — it covers the mistakes that fail silently (build-time
> variables, Vercel scopes, the `vercel.json` backend host, and the Supabase
> email templates that live outside this repo).

### Database separation

Development and production databases are entirely separate. Nothing in the
repositories, services, models or queries knows which one it is talking to —
only `DATABASE_URL` differs. Schema, migrations and queries are identical.

- `DATABASE_URL` — runtime connections.
- `DIRECT_URL` — migrations.
- `npm run start` runs `prisma migrate deploy` before booting, so production
  migrations happen through the deployment, not by hand.
- `prisma db seed` is destructive (it clears every table) and **refuses to run**
  against production unless `ALLOW_DESTRUCTIVE_SEED=true` is set deliberately.

### The process

1. **Configure production environment variables**
   - Backend host (Azure Container Apps): set the variables from
     `backend/.env.production.example` as Container App environment variables
     and secrets. These are runtime — a revision update applies them.
   - Frontend host (Vercel): set the variables from
     `frontend/.env.production.example` in the **Production** scope. These are
     build-time — they must exist before the build runs.
   - Admin host: same, from `admin-frontend/.env.production.example`.

2. **Connect production infrastructure** — production database, Redis, storage
   bucket, Supabase project and email provider. Point the variables at them.

3. **Deploy the same codebase.** No branch, no edit, no find-and-replace.

Then verify:

- [ ] Backend boots — a validation failure names the exact missing/invalid variable.
- [ ] The startup banner shows `Environment production` and the expected frontend URL, storage provider and mail driver.
- [ ] `GET /health` responds.
- [ ] Login works, and its cookie is `Secure` with the expected domain.
- [ ] A password-reset email arrives with a **production** link.
- [ ] Uploads land in the production bucket and load from the production media host.
- [ ] `/dev/email/*` returns 404/403 (dev endpoints are off).
- [ ] The browser console shows no CORS errors from the production frontend domain.

### Rolling back a configuration mistake

Backend: correct the variable and restart. Frontend: correct the variable and
**redeploy** — the old bundle still holds the old value until it is rebuilt.

---

## 10. Deliberately not configurable

Two categories stay in source on purpose. Both are documented here so their
presence is a decision rather than an oversight.

**1. Values that do not vary by environment**

Third-party provider endpoints (`api.unsplash.com`, `api.giphy.com`,
`api.dicebear.com`) and stock-image content URLs are the same in development and
production. Their *credentials* are configured (`VITE_UNSPLASH_KEY`,
`VITE_GIPHY_KEY`); the endpoints are provider constants, not deployment values.

Loopback and private-network detection (`localhost`, `127.0.0.1`, `192.168.x.x`)
in CORS and URL-validation logic describes network topology, not a deployment.

**2. `IS_DEV_BUILD` in the frontend**

Dev-only routes and panels are gated on the `IS_DEV_BUILD` constant rather than
a `config.features.*` property. This is required, not stylistic: Vite replaces
`import.meta.env.DEV` with a literal, which lets Rollup delete those branches and
their lazy imports from the production bundle entirely. Reading the same flag
through the config object makes it a runtime property access, and the dev-only
code ships to production. Verified: with `IS_DEV_BUILD`, the dev chunks are
absent from `dist/`; via `config.features`, they are present.

Everything that is a genuine runtime behaviour (service worker, version polling,
debug logging, rate limits, dev endpoints) does go through the config layer.

**3. Platform deployment files**

`vercel.json` rewrites (`/_api/*` and `/api/media/*` → the backend host) and the
legacy-domain redirect are read by Vercel *before* the build starts, so they
cannot reference build-time environment variables. They live in the deployment
configuration layer, which is where per-environment platform settings belong —
but they are the one place a backend host is written literally. When the backend
host changes, update `vercel.json` alongside `VITE_API_URL`.

Note that the app does not depend on those rewrites for normal operation:
`VITE_API_URL` is authoritative, and `/_api` is only a failover path used when a
filtered network blocks the API's own domain.
