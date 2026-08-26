# Production Setup — What to Be Careful About

Companion to [environment-configuration.md](environment-configuration.md). That
document explains how configuration is structured; this one is the list of
things that actually bite when standing production up for the first time.

Ordered by how easily each one slips through. The first five fail **silently** —
nothing crashes, nothing logs an error, and the app looks deployed.

---

## Contents

- [The silent failures](#the-silent-failures)
- [Database](#database)
- [Secrets](#secrets)
- [Cookies, CORS and CSP](#cookies-cors-and-csp)
- [Infrastructure that must exist first](#infrastructure-that-must-exist-first)
- [Deployment runbook](#deployment-runbook)
- [Post-deploy verification](#post-deploy-verification)
- [Rollback](#rollback)
- [Symptom to cause](#symptom-to-cause)

---

## The silent failures

### 1. Frontend variables are baked in at build time

**The single most common mistake.** Vite inlines every `VITE_*` value into the
bundle when it builds. Setting a variable in the Vercel dashboard *after* a
deploy changes nothing — the old value is already compiled into the JavaScript
being served.

- Set every `VITE_*` variable **before** triggering the production build.
- After changing one, **redeploy**. There is no restart, no cache flush, no
  config reload that will pick it up.
- To confirm what actually shipped, grep the built bundle:

```bash
grep -o "https://[a-z.-]*meetifyy[a-z.-]*" frontend/dist/assets/*.js | sort -u
```

If you see a development domain there, the build used development variables.

### 2. The GitHub OIDC subject depends on `environment:`, not the branch

**This one has already bitten us — in development.** Five consecutive deploys
failed and the DEV Container App sat serving Microsoft's placeholder
hello-world image the entire time, while `dev-api.meetifyy.app` returned a
Cloudflare 1000. Nothing in the repo was wrong.

Both deploy workflows declare an `environment:` so that environment's secrets
are in scope:

```yaml
jobs:
  deploy-prod:
    environment: production      # ← this line changes the OIDC subject
```

When a job declares an `environment:`, GitHub mints the OIDC token with
subject `repo:OWNER/REPO:environment:<name>`. It does **not** use
`repo:OWNER/REPO:ref:refs/heads/<branch>`. Register only the branch form and
Azure rejects the token:

```
AADSTS700213: No matching federated identity record found for presented
assertion subject 'repo:Meetifyyyy/Meetifyy:environment:production'
```

The failure is at the *login* step, before any build, so there is no image, no
migration and no deployment — but the Container App keeps happily serving
whatever it had before, which on a fresh setup is the placeholder image. That
is why this reads as a silent failure rather than an outage.

Register the environment subject (`setup-azure-prod.sh` now does both), and
verify before your first real deploy:

```bash
az ad app federated-credential list --id "$PROD_CLIENT_ID" --query "[].{name:name,subject:subject}" -o table
```

You want `repo:Meetifyyyy/Meetifyy:environment:production` in that list. If you
ever remove `environment:` from the workflow, the branch subject becomes the
live one instead — which is why both are registered.

### 3. Vercel environment scopes are separate

Vercel keeps **Production**, **Preview** and **Development** values apart. A
variable set only under "Development" is *absent* from the production build —
and absent is not an error, it is an empty string.

`VITE_API_URL`, `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are validated
and will throw on boot if missing from a production build. Everything else
degrades quietly:

| Missing variable | Silent consequence |
| --- | --- |
| `VITE_SITE_URL` | Password-reset links point at whatever origin the user happened to be on |
| `VITE_INTERNAL_DOMAINS` | Pasted links to your own site render as external links |
| `VITE_STORAGE_PUBLIC_URL` | Media cache misses — same image fetched repeatedly |
| `VITE_SUPPORT_EMAIL` | Support row vanishes from Settings → Help |

### 4. `vercel.json` names the backend host literally

Vercel reads `vercel.json` *before* the build, so it cannot use build-time
variables. Two rewrites point at the backend by name:

```
/_api/:path*          → <backend host>/:path*
/api/media/:path*     → <backend host>/api/media/:path*
```

When the backend host changes, edit `vercel.json` **in the same commit** as
`VITE_API_URL`. Getting this wrong is invisible in normal use: `/_api` is only
the failover path used when a filtered network blocks the API's own domain, so
it breaks for exactly the users who needed it — typically on campus Wi-Fi.

> Note there are two files, `vercel.json` (root, used by the current project)
> and `frontend/vercel.json`. Keep them in step or delete the unused one.

### 5. Supabase auth emails are stored in Supabase, not in this repo

`backend/supabase-templates/*.html` are **generated artifacts** that get pasted
into the Supabase dashboard. They are rendered with `FRONTEND_URL` and the logo
URLs resolved at render time, so the committed copies currently have
**development URLs baked into them**.

Changing `FRONTEND_URL` in production does not touch them. Signup-confirmation
and password-reset emails will keep showing development branding and links until
you re-render and re-paste:

```bash
cd backend
FRONTEND_URL=https://meetifyy.com LOGO_URL=... npm run render:templates
# then paste supabase-templates/*.html into
# Supabase dashboard → Authentication → Email Templates
```

Also in the Supabase dashboard, under **Authentication → URL Configuration**:

- **Site URL** must be your production frontend URL.
- **Redirect URLs** must include `https://<your-domain>/reset-password` and
  `https://<your-domain>/auth/callback`.

`resetPasswordForEmail` sends `config.auth.resetPasswordUrl` as `redirectTo`.
Supabase silently ignores a `redirectTo` that is not on the allow-list and falls
back to the Site URL — so the email arrives, the link works, and it lands on the
wrong page.

---

## Database

### Development and production must be separate databases

`DATABASE_URL` is the only thing that selects one. No repository, service, model
or query knows which environment it is in. That is the design — and it means a
copy-pasted connection string is all it takes to point production at dev, or a
dev laptop at production, with nothing to warn you.

Double-check the project reference in both `DATABASE_URL` and `DIRECT_URL`
before saving them.

### Two URLs, two ports, two purposes

| Variable | Pooler mode | Port | Used for |
| --- | --- | --- | --- |
| `DATABASE_URL` | transaction | `6543` | runtime queries |
| `DIRECT_URL` | session | `5432` | migrations |

Runtime uses the node-postgres driver adapter over the transaction pooler so
many clients multiplex onto few Postgres backends. Notes that carry over from
the current setup:

- Do **not** add `?pgbouncer=true` — the adapter does not use it, and it makes
  Prisma's own path wrap every query in `BEGIN`/`DEALLOCATE ALL`/`COMMIT`.
- `connection_limit` in the URL sets the client-side pool (capped at 30).
- The true direct host (`db.<ref>.supabase.co`) is IPv6-only. If your platform
  has no IPv6 egress, `DIRECT_URL` must use the session-mode pooler, not the
  direct host, or migrations will hang.

### Migrations run themselves; seeding must not

`prisma migrate deploy` runs as a pre-deploy step in the GitHub Actions workflow
(`azure-deploy.yml`). It applies committed migrations in order
and never drops anything.

`prisma db seed` **deletes every row** before inserting fixtures. It is refused
when `APP_ENV=production` unless `ALLOW_DESTRUCTIVE_SEED=true` is set
deliberately. Leave that variable unset in production. Forever.

Never run `prisma db push` against production — see the README for why.

---

## Secrets

### Regenerate everything; do not promote development values

The development `backend/.env` contains human-readable placeholder secrets —
guessable strings, not random ones. If any of them reach production, admin
session tokens can be forged.

Generate fresh values:

```bash
# one per secret
openssl rand -base64 48
```

Must be new and distinct in production:

```
ADMIN_JWT_ACCESS_SECRET
ADMIN_JWT_REFRESH_SECRET
ADMIN_JWT_PENDING_SECRET
SUPER_ADMIN_PASSWORD
SUPER_ADMIN_API_KEY
```

The three JWT secrets must differ from each other — reusing one lets a pending
(pre-2FA) token be replayed as a full access token.

### Never expose to the browser

Anything in a `VITE_*` variable is public. These belong to the backend only:

```
DATABASE_URL, DIRECT_URL
SUPABASE_SERVICE_ROLE_KEY, SUPABASE_JWT_SECRET
ADMIN_JWT_*_SECRET, SUPER_ADMIN_PASSWORD, SUPER_ADMIN_API_KEY
RESEND_API_KEY, SMTP_PASS
R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
```

The frontend needs the Supabase **anon** key. The service-role key bypasses
row-level security entirely; putting it in `VITE_SUPABASE_ANON_KEY` hands every
visitor full database access.

### `SUPABASE_JWT_SECRET` is optional but wanted

Without it, every authenticated request costs a network round-trip to Supabase
Auth to verify the token. With it, verification is local and free. Find it under
Project Settings → API → JWT Secret.

---

## Cookies, CORS and CSP

### `COOKIE_SAME_SITE` depends on your domain layout

`SameSite` is judged on the **registrable domain**, not the exact hostname.

| Layout | Same-site? | Setting |
| --- | --- | --- |
| `meetifyy.com` + `api.meetifyy.com` | yes | `strict` or `lax` works |
| `admin.meetifyy.com` + `api.meetifyy.com` | yes | `strict` or `lax` works |
| `admin.meetifyy.app` + `api.meetifyy.app` | **no** | needs `none` + `COOKIE_SECURE=true` |

The admin portal authenticates with `HttpOnly` cookies and
`credentials: 'include'`. If the app and API sit on different registrable
domains and `SameSite` is `strict` or `lax`, the browser will not send the
cookie: login appears to succeed, then every subsequent request 401s and the
session looks broken for no visible reason.

`COOKIE_DOMAIN` is separate. Leave it empty for host-only cookies. Set it to
`.meetifyy.com` only when cookies must be shared across subdomains — and note
that a leading-dot domain cannot be set by a host outside it.

Validation refuses `COOKIE_SECURE=false` in production and refuses
`SameSite=none` without `Secure`, so those two mistakes fail at boot.

### CORS wildcards match exactly one label

Patterns in `CORS_ORIGIN_PATTERNS` expand `*` to `[^.]*` — one DNS label, not
"anything". Verified behaviour:

| Pattern | Origin | Allowed |
| --- | --- | --- |
| `https://*.meetifyy.app` | `https://app.meetifyy.app` | yes |
| `https://*.meetifyy.app` | `https://a.b.meetifyy.app` | no |
| `https://*.meetifyy.app` | `https://meetifyy.app` | **no — apex is not a match** |

**List the apex domain explicitly.** `https://*.meetifyy.com` will not allow
`https://meetifyy.com`, and `www` is its own label too.

`FRONTEND_URL` and `ADMIN_URL` are trusted automatically — do not repeat them in
`CORS_ORIGINS`.

Prefer exact origins over patterns. A pattern like `https://*.vercel.app` trusts
every Vercel deployment on the internet, not just yours; scope it to your project
prefix (`https://yourproject*.vercel.app`).

### CSP sources are now additive — set them or lose them

The backend CSP used to carry a hardcoded source list. It is now `'self'` plus
whatever the environment declares, and **empty variables mean an empty list**.

To reproduce the previous production policy:

```env
CSP_ENABLED=true
HSTS_ENABLED=true
CSP_SCRIPT_SRC=https://cdn.jsdelivr.net
CSP_STYLE_SRC=https://fonts.googleapis.com
CSP_FONT_SRC=https://fonts.gstatic.com
CSP_IMG_SRC=https://images.unsplash.com,https://media.giphy.com,https://*.r2.dev
CSP_CONNECT_SRC=wss://<your-api-host>
```

Configured CORS origins are appended to `connect-src` automatically.

This policy applies to responses **from the API**. The SPA is served by Vercel
and gets its CSP from `vercel.json` — that is the one to check if images or
fonts are blocked in the browser.

### HSTS is a one-way door

`HSTS_ENABLED=true` sends `max-age=31536000; includeSubDomains; preload`. Once a
browser sees it, that host **and every subdomain** are HTTPS-only for a year,
cached client-side. If a subdomain is not yet on HTTPS, it becomes unreachable
for visitors who have hit the API, and you cannot undo it remotely. Confirm every
subdomain has a certificate before turning it on.

### You can no longer point localhost at the production API

`CORS_ALLOW_LOCAL_NETWORK` is forced off when `APP_ENV=production`, regardless of
the variable. That is deliberate — a production API must not treat a developer's
machine as a same-trust origin. To debug against production data, use a staging
environment (`APP_ENV=staging`), which keeps the flag configurable.

---

## Infrastructure that must exist first

### Redis is required, not optional

BullMQ powers the email queue. Without `REDIS_URL` the connection falls back to
`127.0.0.1:6379`, which does not exist on a managed host. The app still boots
and requests still succeed — but every queued email is dropped, so password
resets and OTPs never arrive.

Set `REDIS_URL` before first deploy. Use `rediss://` for TLS.

### The email sending domain must be verified

With `EMAIL_DRIVER=resend`, the domain in `EMAIL_FROM` has to be verified in
Resend (DNS records added and confirmed). An unverified domain is rejected per
message, so mail fails one at a time rather than at startup.

Validation catches the structural mistakes — `EMAIL_DRIVER=mailpit` is refused
in production, and `resend` without `RESEND_API_KEY` is refused — but it cannot
check DNS. Send a real test message before launch.

`DEV_EMAIL_REDIRECT` is ignored in production by design, so a stray value cannot
divert live mail.

### Storage public URL

Without `STORAGE_PUBLIC_URL` (or `R2_PUBLIC_URL`), media is served through
`/api/media/<key>` instead of the bucket's public host. That works, but routes
every image through the API — slower, and it costs bandwidth on the API host.
The backend logs a warning at startup when it is missing.

Keep it identical to the frontend's `VITE_STORAGE_PUBLIC_URL`. A mismatch makes
the media cache treat the same file under two keys.

### Node version

`engines` requires Node ≥ 22, and `nixpacks.toml` pins 22. Match it on any other
platform.

---

## Deployment runbook

**1. Provision** — production database, Redis, R2 bucket, Supabase project,
Resend domain. All separate from development.

**2. Backend environment** (Azure Container Apps — environment variables / secrets,
applied on restart). Start from `backend/.env.production.example`. Confirm `APP_ENV=production`,
freshly generated secrets, and the CSP block above.

**3. Supabase dashboard** — Site URL, Redirect URLs, and re-rendered email
templates (see [#5](#5-supabase-auth-emails-are-stored-in-supabase-not-in-this-repo)).

**4. Frontend environment** (Vercel, **Production** scope, **before** building).
Start from `frontend/.env.production.example`. Update `vercel.json` in the same
commit if the backend host changed.

**5. Admin environment** — same, from `admin-frontend/.env.production.example`.

**6. Deploy the same commit.** No branch, no edit, no find-and-replace.

Deploy the **backend first**: it runs migrations, and a frontend calling an
un-migrated API fails on the schema, not on configuration — which sends you
looking in the wrong place.

---

## Post-deploy verification

Boot and configuration:

- [ ] Backend started. A validation failure names the exact variable — read it
      rather than guessing.
- [ ] Startup banner shows `Environment production`, the production frontend
      URL, `Storage r2`, `Mail resend`.
- [ ] `curl https://<api-host>/health` → `200`.
- [ ] Logs are structured JSON, not pretty-printed, and contain no query logs.

Security boundaries:

- [ ] `curl -i -H "Origin: http://localhost:3000" https://<api-host>/health`
      returns **no** `Access-Control-Allow-Origin`.
- [ ] The production frontend origin **does** get one.
- [ ] `POST https://<api-host>/dev/email/test/welcome` → `404`.
- [ ] Login cookie is `Secure`, with the intended `SameSite` and domain.
- [ ] Response carries `Content-Security-Policy` and
      `Strict-Transport-Security`.

End-to-end:

- [ ] Signup, login, logout.
- [ ] Password reset — email arrives, links to the **production** domain, and
      the link works.
- [ ] Admin portal login survives a page reload (proves the cookie is being sent).
- [ ] Upload an image: lands in the production bucket, loads from the production
      media host.
- [ ] Realtime/socket connects — no `wss://` CSP or CORS errors in the console.
- [ ] Browser console clean on first load.

Bundle:

- [ ] No development domain in `frontend/dist/assets/*.js` (grep from
      [#1](#1-frontend-variables-are-baked-in-at-build-time)).
- [ ] No dev-only route chunks shipped:
      `ls frontend/dist/assets | grep -iE "NotificationPlayground|LogoAnimation|InstantMatchPreview"`
      should return nothing.

---

## Rollback

| Layer | To undo a config mistake |
| --- | --- |
| Backend | Fix the variable, restart. Takes effect immediately. |
| Frontend / admin | Fix the variable, **redeploy**. The old bundle keeps the old value until rebuilt. |
| Migration | Write a forward migration. Never edit or delete an applied one. |

Vercel's "promote previous deployment" restores the previous *bundle*, which
still carries whatever variables it was built with — useful for reverting code,
useless for reverting a variable.

---

## Symptom to cause

| Symptom | Likely cause |
| --- | --- |
| App still calls the dev API after changing `VITE_API_URL` | Not rebuilt, or set in the wrong Vercel scope — [#1](#1-frontend-variables-are-baked-in-at-build-time), [#3](#3-vercel-environment-scopes-are-separate) |
| Reset email arrives with a dev link | `FRONTEND_URL` on the backend, or the Supabase templates were never re-rendered — [#5](#5-supabase-auth-emails-are-stored-in-supabase-not-in-this-repo) |
| Reset link lands on the wrong page | Redirect URL not in Supabase's allow-list — [#5](#5-supabase-auth-emails-are-stored-in-supabase-not-in-this-repo) |
| Admin login succeeds then everything 401s | `COOKIE_SAME_SITE` too strict for a cross-domain layout |
| CORS error from the apex domain only | `*.domain` does not match the apex; list it explicitly |
| No emails at all, no errors | `REDIS_URL` unset — the queue has nowhere to run |
| Emails fail one at a time | Sending domain not verified in Resend |
| Images 404 or load slowly | `STORAGE_PUBLIC_URL` unset or mismatched with the frontend |
| Fonts/images blocked in the browser | `vercel.json` CSP (the SPA's), not the backend's |
| Boot fails with a list of variables | Read it — it names every problem at once |
| Migrations hang | `DIRECT_URL` on the IPv6-only direct host |
| API host returns Cloudflare **Error 1000** | DNS is an `A` record on a Cloudflare IP; must be a `CNAME` to the Azure FQDN |
| Custom domain never gets a certificate | Record was proxied before the managed cert validated — set **DNS only** until it issues |
| Azure FQDN works but the custom domain does not | Purely Cloudflare: proxy status, or SSL/TLS not on **Full (strict)** |
| Azure FQDN itself times out | Not DNS — ingress `targetPort` does not match the port the container listens on |
| Deploy fails at "Azure login", AADSTS700213 | Federated credential registered for the branch subject, not `environment:` — [#2](#2-the-github-oidc-subject-depends-on-environment-not-the-branch) |
| API serves a hello-world page after "deploying" | The deploy never ran; Container App still on the placeholder image — [#2](#2-the-github-oidc-subject-depends-on-environment-not-the-branch) |
