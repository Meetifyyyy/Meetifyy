# Infrastructure, environments and operations

How Meetifyy is hosted, how the environments are kept apart, how code reaches
them, and the operational traps that have already caused incidents.

Most entries under [Operational traps](#5-operational-traps) are real failures
that already happened, or ones the code now actively prevents. They share a
shape: **nothing errors at the time, and you find out later** — in a user's
inbox, or five deploys into an outage. Read this document before changing
anything in production.

Related: [DATABASE.md](DATABASE.md) (connection strings, migrations),
[SECURITY.md](SECURITY.md) (CORS, cookies, CSP),
[OBSERVABILITY.md](OBSERVABILITY.md) (Sentry, logs, uptime),
[DECISIONS_AND_GUIDELINES.md](DECISIONS_AND_GUIDELINES.md) (the rules).
Provisioning detail lives in `docs/private/azure-setup.md`, which is kept locally and
never committed (the repository is public); its presence is not authorization
to run the setup scripts.

---

## 1. Environments

Three environments. `APP_ENV` selects which, and it is the single switch that
decides the email driver, queue namespace, cookie security, CSP, HSTS, log
level, and which variables are mandatory.

| | local | development | production |
|---|---|---|---|
| `APP_ENV` | `development` | `development` | `production` |
| Backend | your machine, port 4000 | Azure Container Apps (`meetifyy-api-dev`) | Azure Container Apps (`meetifyy-api`) |
| Azure subscription | — | `4f4979b4…` (sarthak.08saini) | `06a4a60e…` (sarthaksaini208) — a different Microsoft account |
| Azure region | — | UAE North | Central India |
| Supabase | DEV project | Meetfiyy DEV (Singapore) | Meetifyy (Mumbai, `ap-south-1`) |
| Redis | container / local | `meetifyy-redis-dev` | `meetifyy-prod-redis` |
| Email | Mailpit on :1025 (UI :8025) | Resend | Resend |
| Storage | dev R2 bucket | dev R2 bucket | prod R2 (**separate Cloudflare account**) |
| Frontend | Vite dev server | `dev.meetifyy.app` | `meetifyy.app` |
| Admin | Vite dev server | `dev-admin.meetifyy.app` | `admin.meetifyy.app` |
| API | `localhost:4000` | dev container FQDN / `dev-api.meetifyy.app` | `api.meetifyy.app` |
| Deploy trigger | — | push to `development` | push to `main` |
| GitHub environment | — | `development` | `Production` |
| Sentry org | — | `meetifyy-dev` | `meetifyy` |

Local and development deliberately share the dev Supabase project and dev R2
bucket. **Production shares nothing with either.**

Dev and prod live in separate Azure subscriptions on separate Microsoft
accounts — not for tidiness, but because a subscription may hold only one
Container Apps environment.

### Branches

| Branch | Deploys to | Database | GitHub environment |
|---|---|---|---|
| `feature/*` | — (CI only) | — | — |
| `development` | Azure DEV (`meetifyy-api-dev`) | Supabase DEV | `development` |
| `main` | Azure PROD (`meetifyy-api`) | Supabase PROD | `Production` |

Never commit directly to `main`; it deploys to production. The contribution
flow is in [DEVELOPMENT_GUIDE.md](DEVELOPMENT_GUIDE.md#3-contribution-flow).

### Isolation rules

They are separate on purpose, at every layer:

- **Never copy a value from one environment into the other** — not a database
  URL, API key, R2 credential, VAPID key or Firebase file. Production secrets
  are generated fresh, never promoted from dev.
- **Never point a production resource at a dev one, or vice versa.**
- **Never share Redis between environments.** They would share one keyspace: a
  dev worker could execute a *production* job, and a `FLUSHALL` while debugging
  dev would wipe production sessions and queues.
- **`setup-azure-dev.sh` is not a template for production.** Dev enables the
  ACR admin user and has no Redis persistence; production must not.
- Production's `R2` API token should be **Object Read & Write** scoped to its
  two buckets only.

### The isolation guard

`backend/src/config/isolation.guard.ts` refuses to boot a production or staging
process whose database, Redis, R2 bucket, Supabase URL, frontend URL, admin URL
or Firebase project is named like another environment's resource. It also
rejects a `*` in the CORS allowlist on a credentialed API, and (in development
as well as production) any CORS entry that admits a host under `COOKIE_DOMAIN`
belonging to the other environment — see [SECURITY.md](SECURITY.md#6-cors).

- It inspects **hostnames only, never credentials**, so it catches the
  copy-pasted `DATABASE_URL` at startup rather than at the first request.
- It only checks **naming**: a correctly named resource belonging to the wrong
  environment still passes. It is a backstop, not permission to be careless.
  Provision per environment.
- The hostname checks run only in staging and production, so local development
  is never encumbered. A deployment with no `COOKIE_DOMAIN` (a developer
  machine) is not inspected for CORS.
- It protects the *server*. It cannot see a Supabase MCP call, which reaches
  the database directly (see [Supabase MCP](#supabase-mcp)).
- Firebase projects must be named `meetifyy-dev` and `meetifyy-prod` so the
  check means something ([FEATURES_AND_FLOWS.md](FEATURES_AND_FLOWS.md#push-configuration)).

Other code-level rails:

- **`STORAGE_PROVIDER`** is a validated single-value knob (R2 only), so a
  deployment still set to `supabase` fails loudly at boot instead of silently
  resolving media against a bucket that no longer exists.
- **Verification uploads** are routed by key prefix to a private bucket, so a
  new call site cannot accidentally publish identity documents.
- **Supabase Auth templates** are rendered per environment, and the production
  render fails hard if any dev URL survives into the output.

---

## 2. Hosting and managed services

| Service | Used for |
|---|---|
| **Azure Container Apps** | Backend API container, Redis container, and the one-shot migration job. Images in ACR. |
| **Vercel** | Both frontends (separate Vercel projects per environment). |
| **Supabase** | Postgres + Auth. One project per environment. |
| **Cloudflare R2** | All object storage. Two buckets per environment: public media, private verification/conversation media. |
| **Cloudflare DNS + Access** | The `meetifyy.app` zone, and Zero Trust Access in front of `dev.meetifyy.app`, `dev-admin.meetifyy.app` and `admin.meetifyy.app`. |
| **Resend** | Primary provider for the backend's application email (API). |
| **Brevo** | SMTP relay: Supabase Auth's sender, and the backend's failover when Resend reports it did not send. |
| **Sentry** | Error and performance monitoring (optional; off without a DSN). See [OBSERVABILITY.md](OBSERVABILITY.md). |
| **Firebase (FCM)** | Android push delivery (per-environment projects). |

### Azure resources

| | development (`setup-azure-dev.sh`) | production (`setup-azure-prod.sh`) |
|---|---|---|
| Region | `uaenorth` | `centralindia` |
| Resource group | `meetifyy-dev-rg` | `meetifyy-prod-rg` |
| Container registry | `meetifyycr` (admin user **enabled**) | `meetifyyprodcr` (admin user **disabled**) |
| Container Apps environment | `meetifyy-dev-env` | `meetifyy-prod-env` |
| API Container App | `meetifyy-api-dev` | `meetifyy-api` |
| Redis Container App | `meetifyy-redis-dev` (no persistence) | `meetifyy-prod-redis` (hardened, below) |
| Log Analytics workspace | `meetifyy-dev-logs` | `meetifyy-prod-logs-ci` (overridable: a deleted workspace name stays bound for a while) |
| Image pull | ACR admin credentials | user-assigned identity `meetifyy-prod-pull` with **AcrPull** only, shared by the API app and the migration jobs |

- **Why Central India for production:** a subscription may hold only one
  Container Apps environment per region and dev already owns UAE North; sharing
  that environment would put production on dev's internal network, which the
  internal-only Redis ingress relies on for isolation. It also puts the API
  beside the production database (Supabase `ap-south-1`, Mumbai) instead of
  ~1,900 km away. (Dev's API in UAE North talks to a Singapore database, so
  each dev DB round trip costs ~100 ms.)
- Production owns its own registry: it used to share `meetifyycr` with dev, so
  deleting or locking the dev group would have stopped production pulling
  images. CI pushes with its own federated identity; production never pushes.
- A **user-assigned** identity (not system-assigned) because two resources pull
  the same image — the Container App and the short-lived migration job — and a
  per-resource identity would race role-assignment propagation on every deploy.
- API sizing in both environments: 0.5 CPU / 1 GiB, `--min-replicas 1
  --max-replicas 1`. Assumptions that change past one replica are listed in
  [BACKEND_AND_API.md](BACKEND_AND_API.md#what-will-bite-as-the-user-base-grows).

### Production Redis

A self-hosted `redis:7-alpine` Container App, deliberately, on a fixed student
credit: Azure Cache's Basic tier is a single node with no persistence (it loses
as much on a restart), and only Standard prevents the loss that matters, so the
container is hardened instead:

- internal ingress only, port 6379, 1 replica, 0.25 CPU / 0.5 GiB;
- `--maxmemory 320mb` below the container cap, so Redis refuses writes at its
  own ceiling instead of being OOM-killed and losing everything;
- `--maxmemory-policy noeviction` (queue jobs, not cache entries);
- RDB snapshots (`--save 60 100`, `--save 300 10`) to an **Azure Files** share
  (`meetifyyprodredis` storage account, `redis-data` share mounted at `/data`),
  so a restart reloads the last snapshot. RDB rather than AOF because the share
  is SMB and AOF's per-write fsync behaves poorly on it; the trade-off is a
  bounded loss window, not zero loss;
- `--stop-writes-on-bgsave-error no`, so a transient SMB error does not freeze
  every write;
- a TCP liveness probe (15 s initial delay, every 30 s, 3 failures) to catch a
  hung-but-alive Redis.

Development's Redis has none of this — `setup-azure-dev.sh` is not a template
for production.

### Provisioning script

`setup-azure-prod.sh` prompts for every value, or reads them from
`--env-file backend/.env.production`. `--sync-secrets` (with `--env-file`)
provisions nothing: it pushes the credentials onto the existing Container App
and restarts the active revision — the command after rotating a key. It reads
the dotenv file without sourcing it (values may contain `$`, spaces or `#`).
Admin JWT secrets, `SESSION_SECRET` and `OTP_HASH_SECRET` are generated only
when absent and otherwise reused from the env file or the app's existing
secrets, because regenerating them signs out admins (JWT), every user
(`SESSION_SECRET`) or invalidates codes in flight (`OTP_HASH_SECRET`). Never run
it unasked.

---

## 3. Configuration and environment files

Every environment-specific value — domains, database, email, storage, auth
redirects, cookies, CORS — comes from environment variables read through a
central config layer. **No source file needs editing to move between
environments.**

- `backend/src/config/env.ts` is the only place in the backend that touches
  `process.env`. Everything else imports the typed `config` object.
- Validation runs once at import, so a misconfigured environment fails at boot
  with one message listing every problem — not at the first request that
  happens to need the value.
- Each app's `.env.example` and `.env.production.example` are the
  authoritative, annotated variable lists, marking what is required, what is
  secret, and what is inlined at build time.

Load order — earlier wins, and files never override the real process
environment:

```
process env → .env.<APP_ENV>.local → .env.local → .env.<APP_ENV> → .env
```

On Azure Container Apps and Vercel only the first applies; the dotenv files are
a local convenience. Each app has a committed `.env.production.example`
documenting every variable, and a git-ignored `.env.production` holding the
real values. There is no `backend/.env`: anything that goes through
`src/config` loads `backend/.env.local` and `backend/.env.development`, so a
script run "with no environment" is still pointed at development.

**Only `*.example` files are ever committed.** `.gitignore` denies `.env`,
`.env.*`, `*.env` and `*.env.*`, then re-includes only `*.example`.
`git check-ignore` is the way to confirm before you commit.

Frontend variables are inlined by Vite at **build** time, so they must exist in
the Vercel project before the build runs, and a change needs a redeploy.
Nothing in a `VITE_` variable is secret — it ships in the bundle.

Configuration traps:

- **`APP_ENV` must be exactly `production`** (lowercase) in production. An
  unrecognised value (`prod`, `live`, a typo) silently falls back to
  `development` — the Mailpit email driver and the `/dev/*` routes. It falls
  back to `NODE_ENV` when unset.
- `COOKIE_SECURE` defaults to true in production and boot refuses false there.
  `COOKIE_NAME_PREFIX` must never be `mf` outside production (boot refuses it).
- Blank and absent are the same: values are trimmed and an empty string takes
  the default.
- Secret fallbacks: `SESSION_SECRET` and `OTP_HASH_SECRET` fall back to
  `SUPABASE_SERVICE_ROLE_KEY`; `RATE_LIMIT_HASH_SECRET` to
  `SUPABASE_JWT_SECRET`; `SUPPORT_IP_HASH_SALT` to `SUPABASE_JWT_SECRET`, then
  `ADMIN_JWT_ACCESS_SECRET` (boot fails if none is set). Set them explicitly so
  rotating the service-role key does not sign everyone out and void every OTP.
- `DEV_RESOURCE_CHECK_DISABLED=true` turns off the isolation guard's naming
  check; only for a production resource whose name legitimately contains
  "dev". Leave it unset.
- `ADMIN_URL` is added to CORS automatically, so never leave a localhost value
  in a deployed environment.
- `ORIGIN_AUTH_SECRET` (at least 32 characters) makes the API refuse any
  request without a matching `x-origin-auth` header, `/health` excepted. Set it
  only where Cloudflare proxies the API **and** the zone rule that adds the
  header already exists; anywhere else it refuses every request. See
  [Origin protection](#origin-protection-production-api).
- `REDIS_QUEUE_PREFIX` defaults to `bull:<APP_ENV>` and `RATE_LIMIT_KEY_PREFIX`
  to `rl:<APP_ENV>`; override only to separate two deployments of the same
  environment.
- `ACADEMIC_YEAR` overrides the academic year the student-year (batch) policy
  evaluates against; normally absent so the cohort rolls over from the clock.
  Set it only for a deliberate correction, never to pin a year.

Do not edit `backend/.env.production`, the two frontend `.env.production`
files, or Azure Container App secrets unless that specific change was asked
for: they hold live credentials.

---

## 4. CI/CD and the deploy pipeline

Nothing is deployed by hand. Both deploys are automatic on merge.

```
push → ci.yml `validate` passes (await-ci) → build image → push to ACR
     → prisma migrate deploy (one-shot Container App Job)
     → update Container App → health check
```

Workflows (`.github/workflows/`):

| Workflow | Does |
|---|---|
| `ci.yml` | Jobs `backend`, `frontend`, `mobile`, `admin-frontend`, and the aggregate `validate` check. |
| `deploy-dev.yml` | On push to `development`: waits for CI, builds, migrates, deploys DEV. |
| `deploy-prod.yml` | On push to `main`: the same against PROD. |
| `origin-allowlist-check.yml` | Weekly (and on demand): compares the production origin's allow-list with Cloudflare's published ranges and fails when they differ. Changes nothing. |

- **CI gate.** The deploy workflows and CI start from the same push and run
  independently, so a commit whose tests failed used to be built, migrated and
  rolled out anyway (it happened on `development` on 2026-09-28, `62d0d086`).
  The deploy now starts with an `await-ci` job running `scripts/await-ci.sh`,
  which waits for every `validate` run on the commit and fails unless all
  passed. `validate` always reports, pass or fail, so waiting on it cannot
  deadlock. (Path-filtered CI is refused for the same reason: a skipped
  required check reports as *pending*, which would deadlock PRs.)
- **Frontend waits for the backend.** Vercel's `ignoreCommand` runs
  `scripts/await-backend.sh`, which holds the frontend build until the API
  reports this commit. Vercel is much faster than the Docker build + migration
  + rollout, and a bundle expecting a new API contract served against the old
  API can sign everyone out. Vercel's contract is inverted: exit 0 **skips**
  the build, exit 1 runs it; the safe default is to skip (the previous bundle
  keeps working). Frontend-only commits skip the wait.
- **Migrations run before the new image is deployed**, so the schema is always
  ahead of or equal to the running code. If a migration fails the workflow
  exits non-zero and the old app keeps running against the unchanged database.
  Because a rollback reverts code but not migrations, every migration must be
  backward-compatible with the previous release ([DATABASE.md](DATABASE.md)).
- **The production database URL is never a GitHub secret.** Migrations run as
  a Container App Job that reads `DATABASE_URL` from the Container App's own
  secret store. That is why migrations are not run straight from GitHub
  Actions. Any change to the pipeline must preserve this property.
- **Images** are tagged `prod-<sha>` (immutable, used for rollback) and
  `prod-latest` (development: `dev-<sha>` / `dev-latest`); same Dockerfile and source for both
  environments (`node:22-alpine`, three stages: deps → build with
  `prisma generate`, `nest build` and Sentry debug-ID stamping → slim runtime).
- **Migration job.** CI creates a one-shot Container App Job
  `meetifyy-prod-migrate-<sha>` from the new image, with the app's own
  `DATABASE_URL`/`DIRECT_URL` secrets and the pull identity, running
  `prisma migrate deploy` (300 s replica timeout). On failure the job's logs are
  printed **before** the job is deleted (Container Apps job output does not
  reliably reach Log Analytics). A harmless `AuthorizationFailed` line appears
  because CI is only Contributor on the resource group and cannot (and should
  not) write role assignments.
- **Deploy** sets the new image and `GIT_COMMIT_SHA` (reported by `/health`,
  which `await-backend.sh` waits on).
- **Health check:** `https://<fqdn>/health` must return 200 within 3 minutes
  (18 tries, 10 s apart), or the job fails. In production the origin accepts
  Cloudflare's addresses only, so the step first allows the runner's own
  address (ingress rule `ci-health-<run id>`) and removes it on exit; a rule
  left behind by a cancelled run is removed by hand. It prints the rollback command:
  `az containerapp update --name <app> --resource-group <rg> --image <acr>/meetifyy-api:<PREVIOUS_PROD_TAG>`
  — an owner decision, not something to run unasked. Rolling back the image
  does not roll back migrations.
- The `production` GitHub Environment can require a reviewer before the deploy
  job runs (recommended in the workflow).
- Production environment secrets: `AZURE_CLIENT_ID_PROD`, `AZURE_TENANT_ID`,
  `AZURE_SUBSCRIPTION_ID`, `ACR_LOGIN_SERVER`, `AZURE_ACR_IDENTITY_PROD`,
  `AZURE_RESOURCE_GROUP_PROD`, `AZURE_CONTAINERAPP_PROD`; optional
  `SENTRY_AUTH_TOKEN` (secret) and `SENTRY_ORG` / `SENTRY_PROJECT_API`
  (variables).
- CI (`ci.yml`) per job: backend — Prisma generate + validate, both
  typechecks, ESLint (`--max-warnings 0`), build, tests; frontend — boundary
  lint, contract typecheck, ESLint (non-blocking), tests, build, "landing page
  is in the web bundle", "no Capacitor code in the web bundle"; mobile — build,
  "no service worker", "no landing page", bundle-size report; admin — Oxlint,
  typecheck and build; `validate` — every app passed.
- Sentry releases and source-map upload are part of the deploy workflows
  ([OBSERVABILITY.md](OBSERVABILITY.md#releases-and-ci)).
- Do not run `az containerapp update` to ship code. Use the pipeline. Never run
  `setup-azure-prod.sh` (with or without `--sync-secrets`), bind a domain, or
  delete an Azure resource without being asked.

### GitHub OIDC and environments

**The OIDC subject is the environment name, not the branch.** `deploy-prod.yml`
declares `environment: production`, and a job with an `environment:` makes
GitHub mint its OIDC token with subject `environment:production` — **not**
`ref:refs/heads/main`. Register only the branch form and every deploy dies at
"Azure login" with `AADSTS700213` before it builds anything. This took DEV down
for five consecutive deploys while the Container App sat on the placeholder
image.

Worse, **GitHub matches environment names case-insensitively but Entra ID
matches federated-credential subjects case-sensitively.** The actual
environment is named `Production` (capital P) while the workflow says
`production`. All three subjects are therefore registered on the prod app:

```
repo:Meetifyyyy/Meetifyy:environment:Production
repo:Meetifyyyy/Meetifyy:environment:production
repo:Meetifyyyy/Meetifyy:ref:refs/heads/main
```

Changing the `environment:` key in a workflow changes the OIDC token subject
and will break Azure login. It is not a cosmetic rename.

**GitHub environments must stay separate.** `development` and `Production` hold
secrets with the **same names and different values** — `AZURE_TENANT_ID`,
`AZURE_SUBSCRIPTION_ID`, `ACR_LOGIN_SERVER` (and the Sentry token/org/project).
One environment cannot hold both. Merging them would also mean a push to
`development` could mint a token with subject `environment:production` and
authenticate as the production service principal. Keep repo-level secrets
empty so nothing shadows an environment value, and never edit one
environment's secrets while intending the other.

---

## 5. Operational traps

### Database connections

Summarised here; the full explanation is in
[DATABASE.md](DATABASE.md#connection-strings).

- Do not add `pgbouncer=true` (wrong for `@prisma/adapter-pg`).
- Do not add `sslmode=require` (`pg` treats it as `verify-full`, which fails on
  Supabase's chain and breaks production at boot).
- `DIRECT_URL` uses the pooler, not `db.<ref>.supabase.co` (IPv6-only;
  unreachable from Azure Container Apps).
- Percent-encode reserved characters in the password (`@` → `%40`).
- Let CI create the schema: the production database must be empty before its
  first deploy.

### Redis

It is **not a cache**. It holds the BullMQ queues — `email`, `notifications`,
`account-deletion`, `instant-match`, `push`, `ranking` — plus admin sessions,
rate-limit counters and short-lived dedupe markers. Losing it silently drops
OTP emails users are waiting on and deletion jobs the app has already
confirmed.

- `maxmemory-policy` must stay `noeviction`: evicting a queued job deletes work
  a user was promised, whereas a rejected write surfaces as an error the app
  can retry.
- Restart or redeploy the Redis container **only when traffic is low**, never
  while queues are backed up. Deploying the API does not restart it — it is a
  separate Container App.
- Never share Redis between environments (see [Isolation rules](#isolation-rules)).
- Redis is in the request path of every API call (rate limiting), so it is a
  single point of failure for API latency. Reconnect behaviour is a known open
  risk: [BACKEND_AND_API.md](BACKEND_AND_API.md#what-will-bite-as-the-user-base-grows).

### Email

Two independent paths, two providers:

| Path | What | Sent by | Provider |
|---|---|---|---|
| **Supabase Auth mail** | signup confirmation, password reset, magic link | Supabase itself | **Brevo** SMTP, configured in the Supabase dashboard (Authentication → SMTP Settings) |
| **Application mail** | OTP codes, welcome, new sign-in, password changed, security notices, support replies | the backend (`email` queue → `EmailProcessor`) | **Resend** API (primary), with **Brevo** SMTP relay as failover |

Nothing in the backend environment affects the Supabase path, and the backend
must never send the Auth mails itself or users get two of each.

**Supabase Auth SMTP.** Supabase's built-in sender is rate-limited to a few
messages per hour and is not for production; without custom SMTP, signups
silently stop. Point Authentication → SMTP Settings at Brevo
(`smtp-relay.brevo.com:587`, the Brevo login as user, a Brevo **SMTP key** as
password), then raise Auth → Rate Limits, which stays low even after SMTP is
set. (An earlier version of these docs said `smtp.resend.com`; that was
superseded on 2026-09-03 when the backend env examples moved Supabase Auth to
Brevo. Production uses both providers.)

Production runs with `EMAIL_DRIVER=resend` and `EMAIL_FALLBACK_DRIVER=smtp`
pointed at the Brevo relay. The fallback is opt-in (blank by default), so a new
environment has no failover until it is set.

**Backend mail configuration** (`backend/src/config/email.config.ts`):

| Variable | Meaning |
|---|---|
| `EMAIL_DRIVER` | `resend` \| `smtp` \| `mailpit`. Default `resend` in staging/production, `mailpit` elsewhere. `mailpit` is refused at boot in a deployed environment (it would queue mail into a port that does not exist there and drop it silently). |
| `RESEND_API_KEY` | Secret; required when the driver is `resend`. `RESEND_API_URL` overrides the API root (mocks only). |
| `EMAIL_FROM` | Required in staging/production (`noreply@meetifyy.app`). Its domain **must be verified on the Resend account** or every send is a 403; `meetifyy.app` is verified with SPF, DKIM and DMARC. The driver checks once at boot and logs `email.domain_unverified` if not. `RESEND_FROM_EMAIL` is a legacy fallback. |
| `EMAIL_FROM_NAME`, `EMAIL_REPLY_TO`, `EMAIL_SECURITY_FROM` | Display name; a Reply-To that really receives mail; the From for security mail (default `"<name> Security <EMAIL_FROM>"`). `SUPPORT_REPLY_TO` (default `support@meetifyy.app`) is used on support mail. |
| `EMAIL_FALLBACK_DRIVER` | `""` (off) or `smtp`. When `smtp`, `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` are all required at boot — a fallback without credentials would fail at the worst moment. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | The Brevo relay in deployed environments (`smtp-relay.brevo.com`, 587 STARTTLS; 465 means implicit TLS; user = Brevo login email; pass = Brevo **SMTP key**, not the account password). Locally: Mailpit on `127.0.0.1:1025`. The From address must be a verified sender on the Brevo account. |
| `BREVO_API_KEY` | Optional, reporting only: a Brevo **REST API** key (distinct from the SMTP key) that lets the admin analytics panel show Brevo's daily figures and remaining credits. `BREVO_API_URL` defaults to `https://api.brevo.com/v3`. |
| `DEV_EMAIL_REDIRECT` | Local-only safety valve: redirects every message to one address. Ignored in every deployed environment. |

**Failover is deliberately selective** (`email/resend-failure.ts`). A failed
Resend send is classified before anything is retried through Brevo:

- `not-sent` — Resend answered and declined (quota/rate-limit names such as
  `daily_quota_exceeded`, any 429, any 5xx) or the connection failed before
  sending (`ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`) → retried **once** via the
  Brevo relay (`email.failover`).
- `permanent` — the message itself is bad (validation errors, invalid
  addresses, other 4xx) → not failed over; Brevo would reject it too and the
  relay's quota would be wasted.
- `ambiguous` — a timeout, reset or aborted socket, where Resend may already
  have sent it → **never** failed over (that is how one signup produced two
  verification emails); the job fails and BullMQ retries it later. Anything
  unrecognised is treated as ambiguous.

Skipped failovers log `email.failover_skipped` with the reason; a failed relay
send logs `email.failover_failed`. When SMTP is already the primary there is no
failover (it would reuse the transport that just failed). Every attempt that
fails is recorded as undelivered on the ticket/target immediately, and a later
successful retry overwrites it.

**Usage counting.** `EmailUsageService` counts successful hand-overs per
provider per UTC day in Redis (`email:sent:<provider>:<day>`, kept 8 days), a
failover send counting as the relay's. It answers "are we sending, and roughly
how much"; the providers' dashboards remain the authority on delivery, bounces
and complaints. It does not refuse sends.

**Auth templates are frozen at render time.** Supabase cannot read this app's
config when it sends, so every URL inside those templates is baked in when they
are rendered. Rendering under the wrong environment silently produces
production-looking HTML pointing at dev — which is exactly how the committed
templates once came to reference the dev Supabase project and
`dev.meetifyy.app` footer links.

```bash
cd backend
npm run render:templates:dev    # → supabase-templates/development/
npm run render:templates:prod   # → supabase-templates/production/
```

Paste only `production/*.html` into the production project. Nothing is
hand-edited — every URL comes from `SITE_CONFIG`, so changing a link means
changing an env var and re-rendering. The prod render **fails hard** if any dev
URL survives into the output. `render:templates:prod` pins
`NODE_ENV=development` deliberately: `APP_ENV` selects configuration while
`NODE_ENV` only selects React's build, and react-email's renderer crashes under
React's production build.

**Only one branding asset is real.** `WORDMARK_URL` is the only asset any
template reads (`BaseLayout.tsx`). Unset, it falls back to
`${FRONTEND_URL}/wordmark.png`, which the frontend does not ship — so it must
name a real bucket object. `LOGO_URL`, `LOGO_ICON_URL`, `LOGO_WHITE_URL` and
the `ICON_*` variables exist in config but no template references them. Links
in emails come from `SUPPORT_URL`, `PRIVACY_PATH`, `TERMS_PATH`,
`INSTAGRAM_URL`, `LINKEDIN_URL` (defaults in the env examples).

### Storage (R2)

Two buckets, and only one is public. `bucketFor()` routes any key starting
`verification/` to the private bucket, so a new call site cannot forget.
Conversation media also goes to the private bucket. Leaving
`R2_VERIFICATION_BUCKET_NAME` blank collapses that split and **publishes
identity documents** (and chat media). Never set it to the public bucket.

The private bucket must have no public access at all — no r2.dev host, no
custom domain. Uploads to it are written `Cache-Control: private, no-store`.
R2 creates and manages the public bucket's `cdn` DNS record itself — do not add
it by hand.

**Both buckets need CORS**, including the private one. The browser and the app
upload straight to R2 with a presigned PUT; without CORS every upload silently
falls back to routing the file through the Container App — slower, and it burns
egress on the API. (Until this was found on 2026-10-05, *every* direct upload
on dev was failing this way; see [ENGINEERING_LOG.md](ENGINEERING_LOG.md).)
The API's R2 key has no bucket-admin rights, so CORS is applied by the owner in
the Cloudflare dashboard (R2 → bucket → Settings → CORS) or with
`npx wrangler r2 bucket cors set <bucket> --file cors.json`.

Production:

```json
[{ "AllowedOrigins": ["https://meetifyy.app", "https://www.meetifyy.app", "https://localhost"],
   "AllowedMethods": ["GET", "PUT", "HEAD"],
   "AllowedHeaders": ["Content-Type", "Cache-Control", "Range"],
   "ExposeHeaders": ["ETag"], "MaxAgeSeconds": 3600 }]
```

- `https://localhost` is the installed app's origin (Capacitor serves the
  bundle from it, the same reason it is in the API's CORS list). Without it
  every upload from the app falls back to the pass-through.
- `Range` is for video seeking on media loaded with `crossOrigin`.
- Exact origins only — never `*.meetifyy.app`.
- Add the admin origin only if the admin uploads directly.

Development uses the same shape with its own origins:
`https://dev.meetifyy.app`, `https://dev-admin.meetifyy.app`,
`https://localhost`, and the local dev servers `http://localhost:3000` (web),
`http://localhost:3001` (mobile) and `http://localhost:5174` (admin). Those
`localhost:<port>` entries never go on a production bucket.

Check a bucket with a preflight (no credentials needed):

```bash
curl -s -o /dev/null -D - -X OPTIONS "https://<account-id>.r2.cloudflarestorage.com/<bucket>/x" -H "Origin: https://localhost" -H "Access-Control-Request-Method: PUT" -H "Access-Control-Request-Headers: content-type,cache-control" | grep -iE "^HTTP|access-control-allow-origin"
```

`200` with the origin echoed back means allowed; `403` means refused.

Production R2 is a **separate Cloudflare account** from dev — new account ID,
new token, new buckets.

### DNS

- A **CNAME cannot coexist with A/AAAA records at the same name**. The apex
  previously held proxied A/AAAA records pointing at Cloudflare's own IPs,
  which produced Error 1000 ("DNS points to prohibited IP") and served nothing.
- **What is proxied (audited 2026-11-12).** `meetifyy.app`, `www`, `dev`,
  `admin`, `dev-admin`, `api` and `cdn` are orange-clouded;
  `dev-api.meetifyy.app` and every mail record are DNS-only. An earlier version
  of this document said the Vercel hostnames and `api` were grey: they are not,
  and Cloudflare Access depends on the web hosts being proxied.
- `TRUST_PROXY_HOPS` stays **2** with `api` proxied — measured, see
  [BACKEND_AND_API.md](BACKEND_AND_API.md#trust_proxy_hops). Before proxying
  `dev-api`, run the same measurement on dev; do not assume.
- The zone holds **both** environments' hostnames, so zone-wide settings (SSL
  mode, Browser Cache TTL, bot settings) apply to dev and production together.
  Only hostname-scoped rules can be tried on one first.

### Cloudflare edge configuration

Applied to the `meetifyy.app` zone (Free plan) on 2026-11-12. Rules live in
Cloudflare, not in this repository.

| Setting / rule | Value | Why |
|---|---|---|
| SSL mode, minimum TLS | Full (strict), TLS 1.2 | unchanged |
| Always Use HTTPS | on | |
| Browser Cache TTL | **Respect existing headers** | The 4-hour default was stamped on every cacheable response, including a **404 for a missing chunk** — the stale-chunk trap below, created at the edge. |
| Response header rule | `Cache-Control: public, max-age=31536000, immutable` on `/assets/*.{js,css,woff2}` for `meetifyy.app`, `www`, `dev`, **only when the status is 200** | Hashed files never change; the status condition is what a `vercel.json` header rule cannot express. |
| Cache rule | the same hashed assets are kept at the edge for a year, **200s only**; a 404 is revalidated every time | Vercel sends `max-age=0`, so the edge otherwise asks Vercel about every asset request. Hashed names make deploys invalidate themselves. |
| Smart Tiered Cache | on | Fewer edge locations fetch from Vercel. |
| Cache rule | bypass for `api`/`dev-api` hosts and `/api/`, `/_api/`, `/socket.io/` on any host | Authenticated and personal responses are never stored at the edge. |
| WAF custom rule | block `.php`/`.asp`/`.aspx`/`.jsp`/`.cgi`, `/.env`, `/.git/`, `/.aws/`, `/wp-*`, `/phpmyadmin`, `/cgi-bin/` | Scanner noise; no Meetifyy host serves such a path. |
| Rate limiting rule (the plan allows one) | 30 POSTs / 10 s per IP on `api.meetifyy.app` `/api/auth/*` (not `session`, `events`, `sync`) and `/admin/auth/*`, then blocked 10 s | A flood guard far above every application limit; the NestJS limits still decide for real users. An edge 429 carries no CORS headers, so a browser reports it as a network error. |
| Bot Fight Mode | **off** | It challenged datacentre callers of `api`: the Vercel `/_api` failover and `scripts/await-backend.sh` both got a 403 challenge page. The Free plan cannot exempt a path. Never put a challenge in front of `api`: the installed app and Vercel cannot answer one. |
| Managed Free ruleset, L7 DDoS | on (Cloudflare defaults) | |

Test a new edge rule against one address or an unused path first, then widen
it; a rule that is saved has not been shown to work.

### Origin protection (production API)

The Container App `meetifyy-api` accepts **only Cloudflare's IPv4 ranges**
(ingress IP restrictions `cloudflare-01` … `cloudflare-15`, set 2026-11-12).
Its `*.azurecontainerapps.io` hostname answers 403 to everyone else. Before
this, that hostname bypassed the edge entirely, and a forged
`X-Forwarded-For` sent to it minted a fresh rate-limit bucket per request.

- The deploy health check reaches the origin by allowing its own runner's
  address for the length of the check (`deploy-prod.yml`).
- `origin-allowlist-check.yml` compares the list with Cloudflare's published
  ranges weekly and fails when they differ. It never edits the list.
- Cloudflare's ranges are shared by every Cloudflare customer.
  `ORIGIN_AUTH_SECRET` closes that: a zone transform rule adds the
  `x-origin-auth` header and the API refuses requests without it (`/health`
  exempt). **Not active until the secret is set on the Container App and the
  rule exists** — set the rule first, then the secret, or every request is
  refused.
- To remove the restriction in an emergency, set the app's
  `ipSecurityRestrictions` to an empty list.
- Development is not covered: `dev-api` is DNS-only and unrestricted.

### Vercel caching and stale chunks

- Do not apply a year-long immutable `Cache-Control` header to `/assets/*` by
  pathname alone. Vercel header rules also match requests for missing files, so
  that rule can give an error response the same cache lifetime as a valid
  bundle. Leave asset caching to Vercel's static-file defaults; the immutable
  header is added at the Cloudflare edge, where it can be limited to 200s
  ([Cloudflare edge configuration](#cloudflare-edge-configuration)). This applies to
  the admin's `vercel.json` too. Both website config copies (`vercel.json` and
  `frontend/vercel.json`) must agree.
- Upstream Cloudflare cache rules can override origin policy; verify actual
  status and cache headers after deployment before attributing an incident to a
  particular cache layer. A code deployment cannot invalidate a response
  already stored by an upstream cache.
- The stale-chunk recovery marker must survive document startup for its full
  cooldown. Loading `main.jsx` does not prove a lazy route can load. Clearing
  the marker there allowed every subsequent lazy-import failure to reload the
  page again; startup now removes only expired markers. A regression test
  covers repeated startups followed by the same failed import.
- Deploy skew: each deploy removes the previous build's chunks, so a tab open
  across a deploy fails its next lazy import; `staleChunkRecovery.js` reloads
  once per minute ([OBSERVABILITY.md](OBSERVABILITY.md#website)). Vercel's Skew
  Protection would keep old chunks reachable instead (plan-level setting).
- `vercel.json` rewrites `/_api/*` to the backend as a failover path when the
  direct API host is unreachable (rate-limiting caveat:
  [BACKEND_AND_API.md](BACKEND_AND_API.md#known-gap-the-vercel-failover-path)).

### Supabase MCP

The MCP exposes `execute_sql` and `apply_migration` against whichever project
it points at, distinguished only by a project ref inside a tool call — nothing
makes a production call *look* different at the moment you approve it.

- Point the MCP at **development**. Production MCP access should be connected
  only for a specific, stated reason and disconnected (or made read-only)
  afterwards.
- Never enable dev and prod Supabase MCP servers in the same session.
- The rule: **development is where an agent may write; production is where CI
  writes and everyone else reads.**
- Never write to the production database by any route (MCP, `psql`, script).

---

## 6. Access control on hosts

| Host | Who can reach it |
|---|---|
| `meetifyy.app` (+ `www.` redirect) | Public. |
| `api.meetifyy.app` | Public API (CORS-restricted, proxied through Cloudflare; the Azure origin accepts Cloudflare only). |
| `dev.meetifyy.app` | **Cloudflare Access** only. |
| `dev-admin.meetifyy.app` | **Cloudflare Access** only. |
| `admin.meetifyy.app` | **Cloudflare Access** only. |

- Obscure admin URLs do not work: every TLS certificate is published to
  **Certificate Transparency logs**, so any subdomain is discoverable in
  seconds. That is why every non-public site sits behind Cloudflare Access.
  `robots.txt` and `X-Robots-Tag` (the admin sends
  `noindex, nofollow, noarchive, nosnippet, noimageindex` on every response)
  only discourage indexing; they protect nothing.
- When an Access session expires, every same-origin request is redirected to
  the Access login page; the website's launch-time version gate handles that
  ([OBSERVABILITY.md](OBSERVABILITY.md#website)). Because the website's service
  worker is disabled on dev hosts, web push cannot work on `dev.meetifyy.app`
  (a deliberate policy, not changed).
- Access sits in front of browsers only; the installed dev APK talks to
  `dev-api.meetifyy.app`, which is not behind Access.
- Never enable Vercel Authentication on public production domains — it would
  require every visitor to hold a Vercel team seat. Keep it on **preview
  deployments**, where it belongs.
- The admin frontend holds no Supabase credentials by design.

## 7. Vercel configuration

The website is deployed from `vercel.json` (repository root) and
`frontend/vercel.json`, which differ only in build paths (root:
`npm --prefix frontend run build` → `frontend/dist`; frontend:
`npm run build` → `dist`). Everything else — headers, CSP, rewrites,
redirects — must stay identical. The admin portal has its own
`admin-frontend/vercel.json`.

Website routing (`frontend/vercel.json`):

- **Public pages are prerendered HTML** (`about`, `help-and-support`,
  `community-guidelines`, `privacy-policy`, `terms-and-conditions`,
  `cookie-policy`, `login`, `signup`, `forgot-password`, `reset-password`);
  `dist/index.html` is the prerendered landing page and `dist/app.html` the SPA
  shell that every app route (`/home`, `/messages/*`, `/campus/*`, `/crew/*`,
  `/g/:code`, `/post/:id`, `/profile/:username`, …) rewrites to. A path not in
  the known list redirects to `/`.
- **Link previews:** `/post/:id` requested by a social crawler (Facebook,
  X/Twitter, LinkedIn, Slack, WhatsApp, Telegram, Discord, Pinterest, Reddit,
  Applebot, Bluesky, Mastodon, …, matched by User-Agent) is rewritten to the
  API's `/api/share/post/:id/preview`, so shared links unfurl with the post's
  card; humans get the SPA.
- **API proxies:** `/_api/*` → the API (failover when the direct host is
  blocked; `VITE_API_PROXY_PREFIX`), `/api/media/*` and `/api/share/*` → the
  API (host-conditional: `dev.meetifyy.app` goes to `dev-api`), and
  `/api/app-events` → that environment's Sentry ingest (the tunnel).
- **Redirects:** `www.meetifyy.app` → `meetifyy.app` (permanent, pages only);
  `meetify-web.vercel.app` → `dev.meetifyy.app`; `/terms`, `/help`, `/support`,
  `/contact` → their canonical pages.
- **Caching:** HTML, `/`, `index.html`, `app.html`, `sw.js`, `registerSW.js`,
  the manifest and `version.json` are no-store/no-cache (browser and CDN);
  hashed assets use Vercel's defaults (see
  [Vercel caching and stale chunks](#vercel-caching-and-stale-chunks)).
- **Security headers and CSP** on every response:
  [SECURITY.md](SECURITY.md#7-content-security-policy-and-headers).

Admin (`admin-frontend/vercel.json`): SPA rewrite to `index.html`, HTML
no-store, CSP and security headers including `Cross-Origin-Opener-Policy`,
and `X-Robots-Tag` noindex. Hashed assets use Vercel's defaults, as on the
website: its year-long `immutable` rule on `/assets/*` was removed on
2026-11-11 for the reason below.

## 8. Local helper files

- `local/` (git-ignored): local-only dev helpers, the Mailpit binary
  (`local/bin/mailpit`), built APKs (`local/apk/…`), `local/start.sh` (behind
  root `npm run dev`), and scratch fixtures.
- `setup-azure-dev.sh` / `setup-azure-prod.sh`: provision the Azure stacks.
  Never run the prod one unasked.
- `scripts/await-ci.sh`, `scripts/await-backend.sh`: the deploy gates above.
