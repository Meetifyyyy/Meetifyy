# Project structure: local, development, production

Three environments. `APP_ENV` selects which, and it is the single switch that
decides the email driver, queue namespace, cookie security, CSP, HSTS, log
level, and which variables are mandatory.

## Repository layout

```
meetifyy/
├── backend/            NestJS API, Prisma schema + 44 migrations
├── frontend/           React 18 PWA          → Vercel
├── admin-frontend/     React 19 admin panel  → Vercel
├── local/              local-only dev helpers (git-ignored)
├── docs/               these four documents
├── setup-azure-dev.sh      provisions the DEV Azure stack
├── setup-azure-prod.sh     provisions the PROD Azure stack
└── .github/workflows/      ci.yml, deploy-dev.yml, deploy-prod.yml
```

## The three environments

| | local | development | production |
|---|---|---|---|
| `APP_ENV` | `development` | `development` | `production` |
| Backend | your machine, port 4000 | Azure Container Apps | Azure Container Apps |
| Azure subscription | — | `4f4979b4…` (sarthak.08saini) | `06a4a60e…` (sarthaksaini208) |
| Azure region | — | UAE North | Central India |
| Supabase | DEV project | DEV project | PROD project (`ap-south-1`) |
| Redis | container / local | `meetifyy-redis-dev` | `meetifyy-prod-redis` |
| Email | Mailpit on :1025 | Resend | Resend |
| Storage | dev R2 bucket | dev R2 bucket | prod R2 (separate Cloudflare account) |
| Frontend | Vite dev server | `dev.meetifyy.app` | `meetifyy.app` |
| API | `localhost:4000` | dev container FQDN | `api.meetifyy.app` |
| Deploy trigger | — | push to `development` | push to `main` |
| GitHub environment | — | `development` | `Production` |

Local and development deliberately share the dev Supabase project and dev R2
bucket. Production shares nothing with either.

## Environment files

Load order — earlier wins, and files never override the real process
environment:

```
process env → .env.<APP_ENV>.local → .env.local → .env.<APP_ENV> → .env
```

On Azure Container Apps and Vercel only the first applies; the dotenv files are
a local convenience. Each app has a committed `.env.production.example`
documenting every variable, and a git-ignored `.env.production` holding the real
values.

**Only `*.example` files are ever committed.** `.gitignore` denies `.env`,
`.env.*`, `*.env` and `*.env.*`, then re-includes only `*.example`.

Frontend variables are inlined by Vite at **build** time, so they must exist in
the Vercel project before the build runs and a change needs a redeploy. Nothing
in a `VITE_` variable is secret — it ships in the bundle.

## Running locally

```bash
npm run dev:services   # Mailpit + backend + frontend + admin, all at once
```

Or individually: `dev:backend`, `dev:frontend`, `dev:admin`. Mail goes to
Mailpit at `localhost:8025` rather than out to real inboxes.

## Deploy flow

Both workflows are identical in shape, differing only in branch, environment
and target:

```
push → ci.yml must pass → build image → push to ACR
     → prisma migrate deploy (one-shot Container App Job)
     → update Container App → health check
```

Migrations run **before** the new image is deployed, so the schema is always
ahead of or equal to the running code. If a migration fails the workflow exits
non-zero and the old app keeps running against the unchanged database.

The database URL is read from the Container App's secret store at deploy time
and never becomes a GitHub secret. That is deliberate — see
[operations.md](operations.md).

## Isolation

`src/config/isolation.guard.ts` refuses to boot a production or staging process
whose database, Redis, R2 bucket, Supabase URL, frontend URL or admin URL is
named like a dev resource. It inspects hostnames only, never credentials, and it
also rejects a `*` in the CORS allowlist on a credentialed API.

It runs only in staging and production, so local development is never
encumbered. It catches the copy-pasted `DATABASE_URL` at startup rather than at
the first request — but it only checks *naming*, so a correctly named resource
belonging to the wrong environment still passes. Provision per environment.
