# Environment Isolation — Development vs Production

How Meetifyy keeps its development and production environments apart, what
enforces each boundary, and what still has to be done by hand in a provider
dashboard.

Companion documents: `AZURE_SETUP.md` (Azure provisioning),
`docs/environment-configuration.md` (the config layer),
`docs/production-setup-checklist.md`.

> **Credential policy.** Every value below is entered in the owning service's own
> dashboard. No credential belongs in this repository, in a chat message, or in
> a log line. Code and config reference variable *names* only. A credential that
> has been pasted into a chat, a ticket or a commit is compromised and must be
> rotated at its source before use.

---

## 1. The four Vercel projects and two Azure environments

```
                    DEVELOPMENT                     PRODUCTION
Site        dev.meetifyy.app                  meetifyy.app
Admin       (dev admin Vercel project)        admin.meetifyy.app
Backend     meetifyy-api-dev  (meetifyy-dev-rg)   meetifyy-api (meetifyy-prod-rg)
Redis       dev Redis                         prod Redis
Database    Supabase DEV project              Supabase PROD project
Storage     R2 meetifyy-dev                   R2 meetifyy-prod
Branch      development                       main
```

All four Vercel projects build from this one repository. That is why per-branch
static files cannot express the difference: see §3.

---

## 2. Development site — private, not merely hidden

Two independent layers, and only the first is a security control:

| Layer | Mechanism | Stops |
| --- | --- | --- |
| **Access** | **Cloudflare Access** (Zero Trust), email-based policy | Anyone outside the allowed email list from loading the app |
| **Discovery** | `robots.txt` + `X-Robots-Tag: noindex, nofollow, noarchive` | The dev deployment appearing in a search index |

**`robots.txt` and `noindex` are not access control.** They are honoured only by
well-behaved crawlers and stop nothing else. The dev site is private because of
Cloudflare Access; the noindex rules only keep it out of search results.

### Chosen approach: Cloudflare Access with email policy

`dev.meetifyy.app` and the dev/prod admin hostnames sit behind a Cloudflare
Access application whose policy allows specific email addresses (or an
`@meetifyy.app` domain rule). An unauthenticated visitor gets Cloudflare's login
prompt and a one-time PIN to an allowed address; everyone else is refused at
Cloudflare's edge, before the request ever reaches Vercel.

This is a **login-prompt** model, not a "looks nonexistent" one — the hostname
still resolves and still answers. Access-by-WARP-client-only was considered and
rejected; it is the option that hides the site entirely, at the cost of
requiring the WARP client on every device that needs in.

Access is configured entirely in the Cloudflare Zero Trust dashboard. No
credential for it belongs in this repository, and there is no bypass token to
inline into client-side JavaScript.

### Measured state of every hostname (2026-08-31)

Cloudflare Access only protects traffic that goes **through** Cloudflare, and
Vercel always assigns `*.vercel.app` hostnames in addition to any custom domain.
Attaching only one custom domain does not remove them — the dev admin project
has exactly one custom domain and still has
`meetifyy-admin-<hash>-meetify.vercel.app`. So both layers matter, and they
protect different hostnames.

| Hostname | Observed | State |
| --- | --- | --- |
| `dev.meetifyy.app` | 302 → `tiny-tooth-84e6.cloudflareaccess.com/cdn-cgi/access/login/…` | ✅ Cloudflare Access already enforcing |
| `dev-admin.meetifyy.app` | 302 → `tiny-tooth-84e6.cloudflareaccess.com/cdn-cgi/access/login/…` on every path tested | ✅ Cloudflare Access enforcing (verified 2026-08-31) |
| `meetifyy-admin-<hash>-meetify.vercel.app` | 302 → `vercel.com/login?next=/sso-api…` | ✅ Vercel Authentication enforcing |
| `meetifyy.app` / `www.meetifyy.app` | `403` — Cloudflare **Error 1000, "DNS points to prohibited IP"** | ⚠️ Not serving at all |
| `admin.meetifyy.app` | `403` — same Error 1000 | ⚠️ Not serving at all |

Three conclusions:

1. **The dev site is already done.** Cloudflare Access is live on
   `dev.meetifyy.app`, and the Access JWT reports `is_warp: false` — i.e. the
   email/identity policy, not the WARP-client policy.
2. **`dev-admin.meetifyy.app` is now closed too.** Verified path-by-path: `/`,
   `/login`, `/dashboard`, `/users`, `/settings/secrets`, `/index.html`,
   `/favicon.svg` and `/assets/*` all return the Access redirect, and no admin
   HTML is served to an unauthenticated fetch. Its Access token also reports
   `is_warp: false`, i.e. the same email policy as the dev site, on the same
   `tiny-tooth-84e6` team domain. The `*.vercel.app` origin remains sealed by
   Vercel Authentication.
3. **Both production domains are broken**, unrelated to access control. Error
   1000 means their DNS records resolve to a prohibited (Cloudflare-owned)
   address — typically a proxied record pointing at Cloudflare rather than at
   the Vercel target. Production cannot be verified as "public and indexable"
   until this is fixed; it is currently neither.

### The two layers, and which projects get which

They are not alternatives — they cover different hostnames, so use both:

- **Vercel Deployment Protection → keep "Standard Protection" on all four
  projects.** It guards `*.vercel.app` deployment and preview URLs and leaves
  the custom production domain exempt, so it is safe even on the public
  production site: visitors on `meetifyy.app` are unaffected while stray
  deployment URLs stay sealed. Do **not** switch the production site project to
  "All Deployments" — that would put a login wall in front of the public site.
- **Cloudflare Access → on the private custom domains only**:
  `dev.meetifyy.app` (done), `dev-admin.meetifyy.app` (needed),
  `admin.meetifyy.app` (needed once DNS is fixed). Never on `meetifyy.app` or
  `www.meetifyy.app`.

Because the dev custom domains are already Cloudflare-proxied, adding an Access
application needs no DNS, hosting or middleware change.

Avoid stacking both on one hostname: enabling Vercel's "All Deployments" mode on
a domain that already sits behind Access makes users pass two separate login
walls for no additional protection.

Serving the admin **login page** publicly is not itself a data breach — every
admin API call is independently checked by `AdminJwtGuard` (§4). It does mean
the dev admin portal is publicly discoverable, which is what the "dev admin must
be private" requirement rules out.

### The PWA service-worker bypass (fixed in code; needs one Access rule)

Users who had installed the Meetifyy PWA on their phone kept reaching the dev
site after Cloudflare Access was switched on. Access was not failing — it was
never consulted.

The service worker's navigation route serves `/index.html` straight from the
Workbox precache (`createHandlerBoundToURL('/index.html')`), and every hashed
asset is precached alongside it. An installed PWA therefore renders the entire
app shell **without issuing a single network request**, and a request that is
never made is one Cloudflare Access can never see.

Root cause: `enableServiceWorker` fell back to `!IS_DEV_BUILD`. `IS_DEV_BUILD`
means "running the Vite dev server", so it is false for *any* built bundle —
the dev deployment included. The worker was therefore live on dev.

**Fixed in code**, two halves:

1. The worker is now gated on `VITE_APP_ENV === 'production'`, opt-in and
   fail-closed, so only the production build ships a caching worker. The
   production build is unchanged: still 150 precache entries and a
   `manifest.webmanifest`.
2. Non-production builds emit a **self-unregistering tombstone `sw.js`**
   (`tombstoneServiceWorkerPlugin` in `frontend/vite.config.js`) that deletes
   every cache, unregisters itself, and re-navigates open tabs onto the network.
   Simply omitting the file would not work: a 404 leaves the previously
   installed worker in place, still serving its cached shell forever. The
   client-side teardown in `main.jsx` now purges caches too, not just the
   registration.

**Required manual step — without it the fix cannot reach the phones that have
the problem.** Browsers refuse to apply a service-worker update whose script
request is *redirected*, and `/sw.js` currently returns the Access 302:

```
https://dev.meetifyy.app/sw.js         302 → cloudflareaccess.com
https://dev-admin.meetifyy.app/sw.js   302 → cloudflareaccess.com
```

So an already-installed dev PWA can never fetch the tombstone and will keep
serving its cached shell indefinitely. Add a Cloudflare Access **Bypass** policy
for the path `/sw.js` on both dev hostnames. `/sw.js` is a static script
carrying no user data, so exempting it leaks nothing — and it is the only way to
reach the stale installations. Once traffic has drained, the bypass can be
removed.

Note the ordering: existing installs are only torn down when the browser next
successfully fetches `/sw.js`. Until the bypass exists, this fix protects new
visitors but not the already-affected phones.

### Cloudflare Access scope (verified 2026-08-31)

Access is applied to the three private surfaces and **never** to the public
production site:

| Hostname | Access | Correct? |
| --- | --- | --- |
| `dev.meetifyy.app` | enforced | ✅ |
| `dev-admin.meetifyy.app` | enforced | ✅ |
| `admin.meetifyy.app` | **not yet applied** | ❌ still to do — blocked on the DNS fault below |
| `meetifyy.app` | none | ✅ must stay public |
| `www.meetifyy.app` | none | ✅ must stay public |

Adding Access to `meetifyy.app` or `www.meetifyy.app` would put a login wall in
front of the public product and de-facto take it offline. Never do it.

`admin.meetifyy.app` cannot be protected until it resolves — it currently
returns Cloudflare Error 1000 along with both production site hostnames.

---

## 2b. Version and cache management (replaces the force-refresh)

The old behaviour polled `version.json` every 15 seconds and, on seeing a newer
build, unregistered the service worker, deleted every cache and
`location.replace()`d onto a `?_v=` URL. A deploy therefore reloaded the entire
active user base mid-session, losing scroll position, half-typed messages and
open dialogs.

It existed for a real reason — users genuinely did get stuck on stale builds —
but it treated the symptom. The cause was that a navigation could be answered
from cache. That is now fixed at the caching layer, so nothing needs forcing:

| Layer | Behaviour | Why |
| --- | --- | --- |
| `index.html` + every SPA route | `Cache-Control: no-store, must-revalidate` | A navigation can never be answered from the HTTP cache |
| Service worker navigations | **NetworkFirst**, 4s timeout, `app-shell` fallback | A reload fetches the newest document; offline still works |
| `/assets/*` (JS/CSS) | `immutable`, 1 year | Content-hashed, so a new build means new URLs — never stale |
| New service worker | installs, then **waits**; promoted at next boot | Never seizes a running tab |
| `version.json` | polled every 5 min, **reports only** | Surfaces "update available"; never reloads |

The header fix matters more than it looks: Vercel matches headers against the
**request path**, not the rewrite destination. The `no-store` on `/index.html`
therefore never applied to `/feed`, `/messages` or any other deep route — those
fell through to the catch-all and were cacheable. All three `vercel.json` files
now carry an explicit `no-store` rule matching the same pattern as the SPA
rewrite.

Net effect, which is the actual requirement:

- **An existing session is never interrupted.** No polling reload, no
  `controllerchange` reload, no cache wipe under a live page.
- **Every new visit or reload lands on the newest build**, because the document
  is uncacheable and fetched network-first, and its asset URLs are new.
- **Nobody gets stuck on a stale bundle**, because there is no path by which an
  old document survives a reload.

`useVersionCheck()` now returns `{ updateAvailable, applyUpdate }` and performs
no navigation of its own. Use `updateAvailable` to offer a refresh; call
`applyUpdate()` only from an explicit user action. Nothing renders it today, so
the current behaviour is simply "no interruption".

The one remaining automatic reload is deliberate and unchanged: the chunk-load
error handlers in `App.jsx` and `ErrorBoundary.jsx` reload **once** (capped via
`sessionStorage`) if a document does request a chunk that no longer exists. That
is recovery from an actual failure, not a scheduled interruption.

---

## 3. Indexing control

`robots.txt` for the main site is **generated at build time** by
`frontend/scripts/generate-robots.mjs`, which runs as the first step of
`npm run build`.

A committed static `robots.txt` cannot work here: one repository builds four
Vercel projects, so any committed file would be wrong for three of them.
Vercel's `headers` in `vercel.json` are static for the same reason, which is why
the `X-Robots-Tag` rules are matched on the request **host** instead.

The generator is **opt-in and fails closed**: indexing is emitted only when
`VITE_APP_ENV=production` exactly. Unset, misspelled or any other value produces
`Disallow: /`. The generated file is git-ignored so a wrong-environment copy can
never be committed.

| Build | Result |
| --- | --- |
| `VITE_APP_ENV=production` | `Allow: /`, private paths disallowed, sitemap line |
| `VITE_APP_ENV=development` | `Disallow: /` |
| unset / anything else | `Disallow: /` |

The admin portal's `robots.txt` is **static** (`admin-frontend/public/robots.txt`)
and always `Disallow: /` — there is no environment in which indexing an admin
portal is correct.

`X-Robots-Tag: noindex, nofollow, noarchive, nosnippet, noimageindex` is sent:

- by the admin portal on **every** route in **every** environment;
- by the main site only for the hosts `dev.meetifyy.app`, `staging.meetifyy.app`
  and `*.vercel.app` (preview deployments). Production `meetifyy.app` is
  untouched and stays fully indexable.

No production canonical URL, sitemap or metadata is generated from a dev build:
every site URL derives from `FRONTEND_URL` / `VITE_SITE_URL`, which differ per
environment.

---

## 4. Admin portals — both private, both environments

Knowing the URL grants nothing. Enforcement is server-side in the backend, so a
client-side route guard is never the thing standing between a request and the
data:

```
Request → Cloudflare Access (email policy) → AdminJwtGuard → handler
```

`AdminJwtGuard` (`backend/src/common/guards/admin-jwt.guard.ts`) independently,
on every request:

1. verifies the JWT signature (`ADMIN_JWT_ACCESS_SECRET`);
2. re-reads the `SuperAdmin` row and rejects a disabled account — a token issued
   before the account was disabled stops working immediately;
3. checks the session row is neither revoked nor expired;
4. requires a matching CSRF token on POST/PUT/PATCH/DELETE.

`AdminGuard` additionally re-reads the user's **current** role from the database
rather than trusting a role claim in the token, and rejects `BANNED`,
`SUSPENDED` and `DELETED` accounts. An authenticated non-admin is therefore
rejected by the backend, not merely redirected by the browser.

---

## 5. Backend isolation guard (new)

`backend/src/config/isolation.guard.ts` runs at boot in **staging and production
only** and refuses to start the process if it is pointed at another
environment's resources — the failure mode where every variable is individually
valid but collectively belongs to the wrong environment.

It inspects `DATABASE_URL`, `DIRECT_URL`, `REDIS_URL`, `REDIS_HOST`,
`SUPABASE_URL`, the R2 bucket, `FRONTEND_URL` and `ADMIN_URL` for `dev`/`development` naming (production additionally rejects
`staging`), and rejects a `*` CORS origin — which on this credentialed API would
expose authenticated responses to any site on the internet.

Only the host and path of a connection string are examined, never the
credentials inside it, and the error message cannot echo a password.

This exists because queue namespacing is **not** isolation: `REDIS_QUEUE_PREFIX`
keeps two environments off each other's BullMQ queues, but they still share one
keyspace, one memory budget and one eviction policy, and a `FLUSHALL` in dev
still empties production's sessions and cache.

`DEV_RESOURCE_CHECK_DISABLED=true` escapes the check for a legitimately
dev-named production resource. It is deliberately awkward and logs loudly.

---

## 6. Storage — Cloudflare R2 only, and the dev-bucket fallback

**Cloudflare R2 is the only storage backend.** `STORAGE_PROVIDER` accepts no
other value: `local` was declared but never implemented, and Supabase Storage
has been removed entirely (see §6a). A deployment that still sets
`STORAGE_PROVIDER=supabase` now fails at boot rather than resolving media
against a bucket that no longer exists.

`R2_BUCKET_NAME` and the former `SUPABASE_BUCKET_NAME` defaulted to
`meetifyy-dev` unconditionally. A deployed environment that omitted the variable therefore read
and wrote the **development** bucket — production avatars, profile and community
covers, group avatars and event images landing in dev storage, where dev could
overwrite them.

The `meetifyy-dev` default now applies only outside staging/production; a
deployed environment must name its own bucket or fail to boot.

`setup-azure-prod.sh` already sets `R2_BUCKET_NAME=meetifyy-prod` explicitly, so
current production was not affected — the fix closes the hole for any future
environment that forgets it.

---

## 6a. Supabase Storage removal

Supabase Storage held exactly **one** live object: `email-assets/wordmark.png`
(26,141 bytes), the wordmark embedded in outgoing email. It has been copied to
R2 at `email-assets/wordmark.png` in `meetifyy-media`, verified byte-identical
by checksum, and `WORDMARK_URL` repointed off `*.supabase.co` onto the R2 public
host.

The `meetifyy-dev` Supabase bucket referenced by four legacy `Media` rows **no
longer exists**, so those objects were already unreachable. All four rows are
orphaned — no message, user, community, conversation, event or crew record
references any of them — so nothing user-visible changed when the Supabase
resolution path was removed.

Removed from the codebase: the `supabase` and `local` values of
`STORAGE_PROVIDER`, `SUPABASE_BUCKET_NAME`, `getSupabasePublicUrl()`, both
`provider === 'supabase'` resolution branches in `uploads.service.ts`, the
Supabase branch in `default-assets.service.ts`, and the stale
`backend/upload-wordmark.ts` one-off (which uploaded to Supabase Storage).

Supabase remains in use for **Auth and Postgres** — only its Storage product is
gone.

The now-empty `email-assets` Supabase bucket still exists. Deleting it is a
manual dashboard step (§8.9); nothing reads from it any more.

---

## 7. Variable names and the dashboard that owns each value

Names only. Every value is entered in the dashboard named in the last column.

### Backend — Azure Container App (`meetifyy-api-dev` / `meetifyy-api`)

Set under **Azure Portal → Container App → Configuration** (secrets as Container
App secrets or Key Vault references), per environment.

| Variable | Value comes from |
| --- | --- |
| `APP_ENV` | literal `development` / `production` |
| `DATABASE_URL`, `DIRECT_URL` | Supabase → Settings → Database (that env's project) |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API (Auth + Postgres only; Storage is not used) |
| `SUPABASE_JWT_SECRET` | Supabase → Settings → API |
| `REDIS_URL` | Azure Portal → Redis resource → Access keys |
| `REDIS_QUEUE_PREFIX` | literal `bull:development` / `bull:production` |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Cloudflare → R2 → API Tokens |
| `R2_BUCKET_NAME`, `R2_VERIFICATION_BUCKET_NAME` | Cloudflare → R2 bucket names |
| `R2_PUBLIC_URL` / `STORAGE_PUBLIC_URL` | Cloudflare → R2 public host / CDN domain |
| `WORDMARK_URL` and the other asset URLs | Cloudflare → R2 public host (no longer Supabase) |
| `RESEND_API_KEY` | Resend → API Keys (separate key per environment) |
| `EMAIL_FROM`, `EMAIL_REPLY_TO` | Resend → verified domain for that environment |
| `ADMIN_JWT_ACCESS_SECRET`, `ADMIN_JWT_REFRESH_SECRET`, `ADMIN_JWT_PENDING_SECRET` | generated per environment; stored only in Azure |
| `SUPER_ADMIN_API_KEY` | generated per environment; stored only in Azure (see §9) |
| `FRONTEND_URL`, `ADMIN_URL`, `BACKEND_URL` | that environment's Vercel domains |
| `CORS_ORIGINS`, `CORS_ORIGIN_PATTERNS` | that environment's origins only |
| `SENTRY_DSN` | Sentry → project settings |

### Frontend / admin — Vercel (four projects)

Set under **Vercel → \<project\> → Settings → Environment Variables**, scoped to
Development / Preview / Production within that project.

`VITE_*` variables are **inlined into the browser bundle at build time**. Only
browser-safe values may ever appear: `VITE_SUPABASE_ANON_KEY` yes,
`SUPABASE_SERVICE_ROLE_KEY` never.

> **Vercel's "Production" is not our production.** Each of the four projects has
> its own Production/Preview/Development scopes, and the *dev* projects are wired
> so their **Production** scope is built from the `development` branch — the dev
> admin dashboard reads "Production Deployment … push to the `development`
> branch". So a dev project's variables must be entered under Vercel's
> **Production** scope while holding *development* values.
>
> The trap this sets: `VITE_APP_ENV` must be **`development`** in the dev
> projects even though Vercel labels that scope "Production". Setting it to
> `production` because the dashboard says so would make the dev site emit an
> indexable `robots.txt` (§3) and advertise itself to search engines.

| Variable | Value comes from |
| --- | --- |
| `VITE_APP_ENV` | literal `development` / `production` — **drives robots.txt, §3** |
| `VITE_SITE_URL` | that project's own domain |
| `VITE_API_URL` | that environment's Azure backend FQDN |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Supabase → Settings → API (that env's project) |
| `VITE_STORAGE_PUBLIC_URL` | Cloudflare → R2 public host |
| `VITE_SENTRY_DSN` | Sentry → project settings |

### GitHub Actions

Set under **GitHub → Settings → Environments**. The `development` and
`production` GitHub Environments already gate their secrets so a dev workflow
cannot read production credentials: `AZURE_CLIENT_ID_PROD`,
`AZURE_RESOURCE_GROUP_PROD`, `AZURE_CONTAINERAPP_PROD` and their `_DEV`
counterparts.

---

## 8. Remaining manual steps (dashboard access required)

1. ~~Cloudflare Zero Trust — add an Access application for
   `dev-admin.meetifyy.app`.~~ **Done and verified 2026-08-31.**
2. **Fix production DNS (Cloudflare Error 1000)** on `meetifyy.app`,
   `www.meetifyy.app` and `admin.meetifyy.app` — all three are returning 403 and
   serving nothing. Then add an Access application for `admin.meetifyy.app`
   only, never for the public site.
3. **Vercel — confirm "Standard Protection" on all four projects** (§2). Leave
   the production site project on Standard, never "All Deployments".
4. **Cloudflare Access — add a Bypass policy for `/sw.js`** on
   `dev.meetifyy.app` and `dev-admin.meetifyy.app`, so already-installed dev
   PWAs can receive the self-unregistering worker (§2). Without this, phones
   that already have the PWA keep bypassing Access indefinitely.
5. **Vercel — set `VITE_APP_ENV`** in all four projects. Production must be
   exactly `production` or the production site ships `Disallow: /` and
   de-indexes itself.
6. **Supabase — confirm two separate projects** exist and that no dev
   deployment holds production credentials.
5. **Cloudflare — confirm `meetifyy-dev` and `meetifyy-prod` buckets exist** and
   that the dev R2 API token is scoped so it *cannot write* the prod bucket.
   Bucket separation by name does not by itself prevent a dev key with account
   -wide permissions from writing production objects.
6. **Resend — separate API key per environment**, and restrict dev sending to
   approved test recipients.
7. **Azure — verify dev and prod Redis are distinct resources** in
   `meetifyy-dev-rg` and `meetifyy-prod-rg`.
8. **Rotate any credential** that has ever been pasted into a chat, a ticket or
   a commit.
9. **Supabase — delete the now-unused `email-assets` bucket** once you have
   confirmed the R2 copy renders in a real email. Left in place deliberately:
   deleting stored objects is not something to do automatically.
10. **Set `WORDMARK_URL`** (and the other asset URLs) to R2 hosts in the Azure
    Configuration blade for **production** — `backend/.env.production.example`
    ships it empty, and an unset value falls back to
    `${FRONTEND_URL}/wordmark.png`, which is not currently served.

---

## 9. Known residual risks

- ~~**`SUPER_ADMIN_API_KEY` is a full admin bypass.**~~ **Resolved — removed.**
  `AdminGuard` accepted `x-super-admin-api-key` / `x-admin-secret` and granted
  admin with no user, no session, no CSRF check and no IP restriction, as a
  single static string that could not be revoked per actor.

  It turned out to be **dead code**: `AdminGuard` was applied to zero
  controllers (all 10 admin surfaces already use `AdminJwtGuard`), it was not
  registered as a global guard, the variable was unset everywhere, and neither
  Azure setup script provisioned it. No client ever sent the header. It was a
  leftover from the pre-`AdminJwtGuard` architecture that the codebase had
  already been migrating away from.

  The guard class, its provider registration, the config entry and every
  env/doc reference have been deleted, so the bypass cannot be re-enabled by
  setting a variable.
- **Session/admin binding.** `AdminJwtGuard` loads the session by id and the
  admin by `sub` but does not assert `session.adminId === payload.sub`. Not
  exploitable without the signing secret, since the server mints both claims —
  but asserting it is cheap defence in depth.
- **Dev site reachability** until Cloudflare Access *and* the Vercel-origin
  bypass fix are both in place (§2, §8.1). Access on the custom domain alone
  leaves the `*.vercel.app` URLs open.
- **Cloudflare token scope**: see §8.5.
