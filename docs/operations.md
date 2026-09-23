# Operations: the things that bite

Every item here is a real failure that happened, or one the code actively
prevents. They share a shape: **nothing errors at the time, and you find out
later** — in a user's inbox, or five deploys into an outage.

## Deploys

### The OIDC subject is the environment name, not the branch

`deploy-prod.yml` declares `environment: production`, and a job with an
`environment:` makes GitHub mint its OIDC token with subject
`environment:production` — **not** `ref:refs/heads/main`. Register only the
branch form and every deploy dies at "Azure login" with `AADSTS700213` before it
builds anything. This took DEV down for five consecutive deploys while the
Container App sat on the placeholder image.

Worse, **GitHub matches environment names case-insensitively but Entra ID
matches federated-credential subjects case-sensitively.** The actual environment
is named `Production` (capital P) while the workflow says `production`. All
three subjects are therefore registered on the prod app:

```
repo:Meetifyyyy/Meetifyy:environment:Production
repo:Meetifyyyy/Meetifyy:environment:production
repo:Meetifyyyy/Meetifyy:ref:refs/heads/main
```

### GitHub environments must stay separate

`development` and `Production` hold secrets with the **same names and different
values** — `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `ACR_LOGIN_SERVER`. One
environment cannot hold both. Merging them would also mean a push to
`development` could mint a token with subject `environment:production` and
authenticate as the production service principal.

Keep repo-level secrets empty so nothing shadows an environment value.

### The production database URL is never a GitHub secret

Migrations run as a one-shot **Container App Job** that reads `DATABASE_URL`
from the Container App's own secret store. That is why migrations are not run
straight from GitHub Actions — doing so would require putting the production
database URL into GitHub secrets. Any change to the deploy pipeline must
preserve this property.

## Database

### Do not add `pgbouncer=true`

That flag is specific to Prisma's Rust query engine. This backend uses
**`@prisma/adapter-pg`** (`prisma.service.ts`), so queries go through
node-postgres, which does not use named prepared statements by default —
transaction pooling is already safe. `connection_limit` is read by the app's own
`buildPool()` to size the pg Pool.

### Do not add `sslmode=require`

The installed `pg` treats `require` as `verify-full`, which **fails on
Supabase's certificate chain** and would break production at boot. Both URLs
connect correctly without it.

### `DIRECT_URL` uses the pooler, not the direct host

`db.<ref>.supabase.co` is **IPv6-only**, which Azure Container Apps cannot
reach. Both URLs therefore use `aws-0-<region>.pooler.supabase.com` — `:6543`
transaction mode for runtime, `:5432` session mode for migrations.

### Percent-encode the password

A raw `@` in the password makes the URI ambiguous; Prisma rejects it (`P1013`)
and lenient parsers split on the last `@`. Encode reserved characters —
a password containing `@` must have it written as `%40` before it goes into
the URI.

### Let CI create the schema

The production database must be **empty** before the first deploy. Building
tables by hand — via MCP or SQL — leaves Prisma's `_prisma_migrations` table
empty, so the first `prisma migrate deploy` tries to apply migration 1 of 44
against tables that already exist, fails on "already exists", and leaves you
hand-baselining migration history on a live database.

## Redis

It is **not a cache**. It holds five BullMQ queues — email, notifications,
moderation, account-deletion, instant-match — plus admin sessions and rate-limit
counters. Losing it silently drops OTP emails users are waiting on and deletion
jobs the app has already confirmed.

`maxmemory-policy` must stay `noeviction`: evicting a queued job deletes work a
user was promised, whereas a rejected write surfaces as an error the app can
retry.

Restart or redeploy the Redis container **only when traffic is low**, never
while queues are backed up. Deploying the API does not restart it — it is a
separate Container App.

Never share Redis between environments. They would share one keyspace: a dev
worker could execute a *production* job, and a `FLUSHALL` while debugging dev
would wipe production.

## Email

### Two independent paths

1. **Backend mail** (OTP, welcome, support) — sent by the app via the Resend
   **API**.
2. **Supabase Auth mail** (signup confirmation, password reset) — sent by
   **Supabase**, which needs its own SMTP configuration.

Supabase's built-in sender is rate-limited to a few messages per hour and is not
for production; without custom SMTP, signups silently stop. Set
Auth → SMTP to `smtp.resend.com:587`, username `resend`, password = the Resend
API key. Then raise Auth → Rate Limits, which stays low even after SMTP is set.

### Auth templates are frozen at render time

Supabase cannot read this app's config when it sends, so every URL inside those
templates is baked in when they are rendered. Rendering under the wrong
environment silently produces production-looking HTML pointing at dev — which is
exactly how the committed templates came to reference the dev Supabase project
and `dev.meetifyy.app` footer links.

```bash
npm run render:templates:dev    # → supabase-templates/development/
npm run render:templates:prod   # → supabase-templates/production/
```

Paste only `production/*.html` into the production project. Nothing is
hand-edited — every URL comes from `SITE_CONFIG`, so changing a link means
changing an env var and re-rendering. The prod render **fails hard** if any dev
URL survives into the output.

`render:templates:prod` pins `NODE_ENV=development` deliberately: `APP_ENV`
selects configuration while `NODE_ENV` only selects React's build, and
react-email's renderer crashes under React's production build.

### Only one branding asset is real

`WORDMARK_URL` is the only asset any template reads (`BaseLayout.tsx`). Unset,
it falls back to `${FRONTEND_URL}/wordmark.png`, which the frontend does not
ship — so it must name a real bucket object. `LOGO_URL`, `LOGO_ICON_URL` and the
`ICON_*` variables exist in config but no template references them.

## Storage

Two buckets, and only one is public. `bucketFor()` routes any key starting
`verification/` to the private bucket, so a new call site cannot forget. Leaving
`R2_VERIFICATION_BUCKET_NAME` blank collapses that split and **publishes
identity documents**.

The private bucket must have no public access at all — no r2.dev host, no custom
domain. Uploads to it are written `Cache-Control: private, no-store`.

**Both buckets need CORS**, including the private one. The browser uploads
straight to R2 with a presigned PUT; without CORS every upload silently falls
back to routing the file through the Container App — slower, and it burns egress
on the API.

```json
[{ "AllowedOrigins": ["https://meetifyy.app", "https://www.meetifyy.app"],
   "AllowedMethods": ["GET", "PUT", "HEAD"],
   "AllowedHeaders": ["Content-Type", "Cache-Control"],
   "ExposeHeaders": ["ETag"], "MaxAgeSeconds": 3600 }]
```

Production R2 is a **separate Cloudflare account** from dev — new account ID,
new token, new buckets. The API token should be **Object Read & Write** scoped
to those two buckets only.

## DNS

A **CNAME cannot coexist with A/AAAA records at the same name**. The apex
previously held proxied A/AAAA records pointing at Cloudflare's own IPs, which
produced Error 1000 ("DNS points to prohibited IP") and served nothing.

Vercel hostnames should stay **grey-clouded permanently**: Vercel already fronts
the site with its own CDN, so proxying adds a second hop for no gain, and
certificate issuance needs to reach the origin directly. R2 creates and manages
the `cdn` record itself — do not add it by hand.

## CORS

### Never a pattern over the shared domain

Development and production share `.meetifyy.app`. Both APIs were provisioned
with `CORS_ORIGIN_PATTERNS=https://*.meetifyy.app`, and development also listed
`https://meetifyy.app`. Measured on 2026-09-23: each API answered the other
environment's frontend and admin with credentialed responses — dev accepted
`meetifyy.app`, `www.` and `admin.`; production accepted `dev.` and
`dev-admin.`. Nothing errored; every request simply worked.

List each environment's exact origins. `FRONTEND_URL`, `ADMIN_URL` and the
installed app's `https://localhost` are added automatically, so:

| | `CORS_ORIGINS` | `CORS_ORIGIN_PATTERNS` |
|---|---|---|
| development | `https://dev.meetifyy.app,https://dev-admin.meetifyy.app` | *(unset)* |
| production | `https://meetifyy.app,https://www.meetifyy.app` | *(unset)* |

`isolation.guard.ts` now refuses to boot when CORS admits a host under
`COOKIE_DOMAIN` that belongs to another environment, judging a pattern by what
it can match. It runs in development as well as production. A deployment with
no `COOKIE_DOMAIN` (a developer machine) is not inspected.

Check a deployed API with a preflight:

```bash
curl -s -o /dev/null -D - -X OPTIONS https://dev-api.meetifyy.app/api/auth/session -H "Origin: https://meetifyy.app" -H "Access-Control-Request-Method: GET" | grep -i access-control-allow-origin
```

No output means refused, which is the correct answer for that pair.

### Do not set `NATIVE_APP_ORIGINS` to an empty value

Unset, it defaults to `https://localhost`, the installed app's origin. Empty
means "no app origins", and every request from the app fails CORS.

## CSP

### Inline scripts must be byte-identical across builds

The report-only `script-src` allows each inline script in `index.html` by its
sha256, listed in **both** `vercel.json` files. Two things kept that list stale:

- The Vite plugin meant to patch it read `dist/app.html` in `closeBundle`, but
  that file is written by `prerender-seo.mjs` after `vite build`. It returned
  silently on every build and never patched anything.
- The version gate carried the commit SHA in its own text, so its hash changed
  on every commit.

The stamp now lives in the `meetifyy-build` meta tag. Never put anything that
varies per build inside an inline script. When you edit one, run
`npx vitest run src/config/__tests__/cspReportOnly.test.js` in `frontend/`: it
prints the exact list to paste. `scripts/verify-csp-hashes.mjs` fails the build
if a built page ships a script the policy does not hash.

Cloudflare's JavaScript Detections script cannot be hashed; see
`SECURITY-AUDIT.md` before enforcing.

## Auth

### A verified account with no `User` row

`UserSession.userId` is a foreign key to `User`, and `syncProfile` is what
creates the `User` row for a verified address. Login and session adoption used
to insert the session first. An account verified at Supabase whose signup
handover never completed then passed the password check and failed the insert:
every sign-in was a 500 (`UserSession_userId_fkey`), and signing in by
username was a 401, because the username lookup reads `User`. Both routes now
run `syncProfile` before `sessions.issue`, so such an account recovers with one
email sign-in.

To find any:

```sql
select a.id, a.created_at from auth.users a
where a.email_confirmed_at is not null
  and not exists (select 1 from public."User" u where u.id = a.id::text);
```

### The signup handover carries its own credential

The two calls after `verifyOtp` (`PATCH /api/users/me`, `POST
/api/auth/session/adopt`) pass the verified session's access token explicitly.
They used to take it from the platform session source, which the installed
app's source never had, so on the APK both went out with no `Authorization`
header. Keep the credential explicit, and never mark a user signed in unless
adoption succeeded.

## Supabase MCP

The MCP exposes `execute_sql` and `apply_migration` against whichever project it
points at, distinguished only by a project ref inside a tool call — nothing makes
a production call *look* different at the moment you approve it.

Once CI/CD applies migrations, disconnect it or make it read-only. The rule:
**development is where an agent may write; production is where CI writes and
everyone else reads.** Never enable dev and prod MCP servers in the same
session.

Note that `isolation.guard.ts` protects the *server*; it cannot see an MCP call,
which reaches the database directly.

## Security posture

- Obscure admin URLs do not work: every TLS certificate is published to
  **Certificate Transparency logs**, so any subdomain is discoverable in
  seconds. Put `admin.meetifyy.app` behind **Cloudflare Access** instead.
- Never enable Vercel Authentication on public production domains — it would
  require every visitor to hold a Vercel team seat. Keep it on **preview
  deployments**, where it belongs.
- The admin frontend holds no Supabase credentials by design.
- `SUPABASE_JWT_SECRET` must stay **blank**: this project migrated to the new
  JWT Signing Keys and its JWKS serves an ES256 key, so no HS256 token is ever
  issued. `JwtGuard` prefers JWKS anyway, so verification stays local and
  zero-network per request.
