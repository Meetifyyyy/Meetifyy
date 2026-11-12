# Security

Authentication, sessions, authorization gates, browser security (CORS,
cookies, CSRF, CSP), email-change protection, and the state of the security
audit. Rate limiting is in
[BACKEND_AND_API.md](BACKEND_AND_API.md#9-rate-limiting); environment
isolation is in [INFRASTRUCTURE.md](INFRASTRUCTURE.md#isolation-rules).

Related history: the 2026-09-09 audit report and the mobile-auth measurements
are preserved in [ENGINEERING_LOG.md](ENGINEERING_LOG.md).

---

## 1. Identity and token verification

- Accounts live in **Supabase Auth**. The backend proxies sign-in/sign-up and
  owns the session; clients do not talk to Supabase for anything but the
  signup `verifyOtp` step.
- User JWTs are verified **locally** against the project's JWKS (`JwtGuard`
  prefers JWKS), so verification is zero-network per request. If local
  verification fails, `validateToken` can fall back to a remote Supabase call
  (which is why socket connections are IP-rate-limited before verification).
- `SUPABASE_JWT_SECRET` must stay **blank**: the project migrated to JWT
  Signing Keys and its JWKS serves an ES256 key, so no HS256 token is ever
  issued.
- The admin console has its own auth (`AdminJwtGuard`, admin JWTs in
  HttpOnly cookies, OTP, CSRF double-submit) and **no Supabase credentials** at
  all, so a compromised admin bundle exposes no database access.

## 2. Sessions

Before 2026-09-09 an access token was a pure bearer credential with nothing
behind it: tokens, **including the refresh token**, sat in `localStorage`,
nothing recorded that a device was signed in, and logout cleared one browser.
Now:

- **A `UserSession` row per device** (migration 08). Device list, "sign out
  this device", "sign out everywhere". Password change revokes our sessions as
  well as Supabase's.
- **Web:** access and refresh tokens in **HttpOnly** cookies (refresh
  path-scoped so it travels rarely), `Secure; SameSite=Strict`, on the
  environment's cookie domain, plus the `<prefix>_sid` session cookie and a
  `<prefix>_csrf` cookie. Tokens left in `localStorage` by older versions are
  purged on load.
- Supabase's own refresh token is held server-side and **sealed with
  AES-256-GCM** (`SESSION_SECRET`; it falls back to the service-role key, so
  nothing is stored unprotected — set it explicitly, and know that rotating it
  signs everyone out).
- **Lifetimes:** the refresh token (and its cookie) lives 30 days
  (`REFRESH_TOKEN_TTL_MS`); the access token is Supabase's (about an hour).
  Admin sessions have their own access/refresh cookies.
- Cookie settings: `COOKIE_SECURE` (forced true in production),
  `COOKIE_SAME_SITE` (default `strict`; local development uses `lax`),
  `COOKIE_DOMAIN` (`.meetifyy.app` when deployed, blank locally),
  `COOKIE_NAME_PREFIX`.
- **Refresh rotates.** A token presented twice is treated as theft
  (`session.refresh_replay`) and burns the whole family, because the server
  cannot tell which holder is legitimate.
- **Lost-rotation recovery** (`user-session.service.ts`), added after the app
  was observed signing users out when the OS killed it between the server
  rotating and the app storing the new token: the old token is accepted again
  only if it is the *immediate* parent of the live token, and that successor
  was **never rotated, revoked or used**, and is **under 60 s old**. The unused
  successor is then revoked and a new one minted from the parent. Rotation is
  atomic (conditional `updateMany`), so two concurrent refreshes can never both
  mint a successor. This is stricter than a plain reuse interval (Supabase uses
  10 s; Auth0 has a "rotation overlap"): an attacker using the old token inside
  the window gets a session that is revoked as soon as the real app returns,
  because its next refresh finds a *used* successor. RFC 9700 §4.14 requires
  reuse detection for public clients.
- **"Used" signal:** `JwtGuard.markSessionUsed` stamps `lastActiveAt` on a
  session's first use, then at most once a minute (which also makes the device
  list's "last active" accurate).
- `JwtGuard` *starts* the session, account-status and legal lookups
  concurrently but *judges* them in a fixed order: a revoked session is always
  401 "signed out", never a suspension. A test pins the precedence.
- Every revocation path (sign out, sign out a device, sign out everywhere,
  password change, refresh replay) also deletes that login's push devices.
- `AuthController.currentSessionId` reads the `<prefix>_sid` cookie, falling
  back to `x-session-id` (cookie wins), so "sign out other devices" and
  "change password" keep the caller's own session on the app too.
- Changing an email does not sign out other sessions.

### Cookies across environments

Both environments set cookies on the shared `.meetifyy.app`, so every cookie
name carries the environment's prefix (`COOKIE_NAME_PREFIX`: `mf` in
production, `mf_dev` in development). A browser signed in to both holds two
separate sets, and neither environment can read, overwrite or clear the
other's.

The admin console's cookies used to be the exception: `admin_access`,
`admin_refresh` and `admin_csrf` in both environments, so signing in to
dev-admin replaced admin's cookies and the reverse. They now follow the prefix
(`adminCookieName` in `admin-auth-cookies.ts`): production keeps the bare
`admin_*` names, so live admin sessions were not touched, and development uses
`mf_dev_admin_*`. The admin frontend reads its CSRF cookie by the same rule
(`VITE_SESSION_COOKIE_PREFIX`, derived from `VITE_APP_ENV`). Any other
environment gets its own prefix the same way.

### CSRF

`SameSite=Strict` is the first line, but the cookie domain is the registrable
domain, so every subdomain counts as same-site. Cookie-authenticated mutations
therefore also require the `<prefix>_csrf` double-submit token (constant-time
compare; also on the admin side). CSRF applies only when the credential came
from a cookie: a bearer caller is not CSRF-able.

## 3. The installed app: session-bound bearer tokens

The Android app is the website running in a WebView at origin
`https://localhost`. Its requests to the API are cross-site
(`sec-fetch-site: cross-site`, measured), so the browser **refuses to store
`SameSite=Strict` cookies** from the API — on the first device run all four
(`mf_access`, `mf_refresh`, `mf_sid`, `mf_csrf`) were blocked with
`SchemefulSameSiteStrict` and every authenticated request 401'd.
(`Domain=.meetifyy.app` was not a factor; it domain-matches the API host.)

### Why not just accept bearer tokens

A Supabase access token is a self-contained JWT, valid for its full hour on
signature alone, naming no session. The session table is what makes "sign out
this device", "sign out everywhere" and password-change revocation real, and it
can only be consulted for a request that **names a session**. A bare bearer
caller named none, so the revocation check was skipped — moving a token from
the cookie jar into an `Authorization` header defeated every one of those
controls for up to an hour. `@AllowBearerToken`
(`src/common/decorators/allow-bearer-token.decorator.ts`) says so: adding it to
any other route re-opens the bypass for that route. It stays pinned to the two
signup-handover routes.

### What was built (Option A)

The real question was not "cookie or bearer" but "can a mobile credential name
a session?" It can:

- The app sends `Authorization: Bearer <access>` **and** `x-session-id` on every
  request. `JwtGuard` accepts a bearer that names a session and runs the
  **same** liveness and ownership checks it runs for a cookie
  (`session.userId === token user`, session active). A bare bearer with no
  session id is still refused with 401 "Session has been signed out", except on
  `@AllowBearerToken` routes. Bearer callers are therefore *more* checked than
  before, not less.
- Login and refresh return the tokens in the **body only for the native
  origin** (`isNativeAppClient`: `Origin` ∈ `nativeAppOrigins`). The decision is
  keyed on `Origin` because a browser sets it and a page cannot forge it; a
  spoofable signal (a custom header, a User-Agent sniff) would let an XSS on
  the web app ask for the very tokens the HttpOnly cookies keep from it. A web
  origin gets none of them, and refresh-from-body with a web origin is 401.
- On the device: the refresh token, session id and (since 2026-10-05) the
  access token with its expiry live in **Keystore-backed secure storage**
  (`@aparajita/capacitor-secure-storage`, AES-GCM under an Android Keystore
  key, meeting OWASP MASVS-STORAGE). The access token is stored only when its
  `exp` is knowable and used at launch only with more than 2 minutes left, so
  launches within the hour no longer rotate. This adds no exposure: the 30-day
  refresh token beside it is strictly more powerful, and the access token is
  session-bound, so revoking the device still ends it.
- Android Auto Backup excludes the credential file
  (`WSSecureStorageSharedPreferences.xml`) via both `backup_rules.xml`
  (Android ≤ 11) and `data_extraction_rules.xml` (12+) — each Android version
  reads only one.
- `capacitor.config.json` sets `"loggingBehavior": "none"`: debug builds'
  Capacitor bridge otherwise logs secure-storage results, including the
  refresh token, to logcat.
- No Prisma change was needed; `UserSession` already had `issue`, `rotate`,
  `isActive`, `revoke`, `revokeFamily`, `revokeAllForUser`.

Verified over real HTTP: login from the native origin returns access + refresh
+ session id; from the web origin none; `Authorization` + `x-session-id` → 200;
bare bearer → 401; bearer + unknown session id → 401; refresh-from-body with a
web origin → 401; **revoked session, same token replayed → 401**.

**Rejected alternative (Option B, `COOKIE_SAME_SITE=none`).** One variable and
no client work, but it is global (`sameSite` is read once in `auth.config.ts`
and used by both user and admin cookies), so web and admin would drop from
`Strict` to `None` and lose the first CSRF line to fix one client; it depends on
third-party cookies, which Chrome is phasing out and Android WebView gates
behind `CookieManager.setAcceptThirdPartyCookies`; and WKWebView's ITP is
stricter still. It was acceptable only as a temporary staging unblock.

### The app's origin and CORS

`https://localhost` is allowed by default in code (`DEFAULT_NATIVE_APP_ORIGINS`
in `app.config.ts`, applied whenever `NATIVE_APP_ORIGINS` is unset — which it
is in every environment; `prod-boot.spec.ts` pins that production's exact
variable set allows it). It used to be allowed in dev only, because
`allowLocalNetwork` is forced off in production; the shipped app would have
had no CORS at all and it would have surfaced at release. **Never set
`NATIVE_APP_ORIGINS` to an empty value**: empty means "no app origins", and
every request from the app fails CORS.

iOS uses `"iosScheme": "https"` so it shares the `https://localhost` origin
(`capacitor://localhost`, the old iOS default, is rejected). Unverified on
iOS (needs a Mac).

Allowing `https://localhost` in production means a page served from localhost
on anyone's machine can *make* credentialed requests. What protects the account
is that it still cannot *authenticate*: it has no token and no session id, and
under cookies it cannot read the CSRF cookie cross-origin. The origin being
allowed is not the origin being trusted.

## 4. Auth invariants

Each of these has already broken once.

- **Profile before session.** `UserSession.userId` is a foreign key to `User`,
  and `syncProfile` is what creates the `User` row for a verified account.
  Login and session adoption used to insert the session first: an account
  verified at Supabase whose signup handover never completed then passed the
  password check and failed the insert — every sign-in a 500
  (`UserSession_userId_fkey`), and signing in by username a 401 (the lookup
  reads `User`). Any route that calls `sessions.issue` must run `syncProfile`
  first; such an account now recovers with one email sign-in. A query to find
  any is in [DATABASE.md](DATABASE.md#useful-checks).
- **The signup handover carries its own credential.** The two calls after
  `verifyOtp` (`PATCH /api/users/me`, `POST /api/auth/session/adopt`) pass the
  verified session's access token explicitly (`{ bearer }` on the transport; a
  401 on such a call does not touch the ambient session). They used to take it
  from the platform session source, which the installed app's source never
  had, so on the APK both went out with no `Authorization` header. Never mark a
  user signed in unless `session/adopt` succeeded.
- **The 401 retry must add a credential, not just replace one.** On a cold
  start the first request carries no `Authorization` (the token is loaded from
  storage); the retry after a successful refresh used to rebuild the header only
  if the original had one. It now keys on `session.holdsOwnCredential?.()`.
- **Diagnose auth failures from the logs first** — the dev API logs and the
  Supabase auth logs. The orphaned account and a double OTP submission were
  visible there and nowhere else.
- The React Query cache, ETags and session-scoped storage are cleared on
  sign-out and account switch (`resetClientStateForNewUser`), so the next
  person on a shared device never sees the previous one's data.

## 5. Authorization gates

- **Selfie/ID verification gate (`@VerifiedOnly`)** and **campus affiliation
  gate** — what each protects is in
  [FEATURES_AND_FLOWS.md](FEATURES_AND_FLOWS.md#verification-gates).
- Ownership checks across the authenticated endpoints were reviewed by reading,
  not by probing; a staging IDOR sweep is still the highest-value next step.
- Global `ValidationPipe` with `whitelist` + `forbidNonWhitelisted` prevents
  mass assignment.
- Dev-only endpoints throw in their constructor outside development, are
  env-gated, require a token or loopback (ignoring proxy headers) and compare
  in constant time.

## 6. CORS

Development and production share `.meetifyy.app`. Both APIs were once
provisioned with `CORS_ORIGIN_PATTERNS=https://*.meetifyy.app`, and development
also listed `https://meetifyy.app`. Measured on 2026-09-23: each API answered
the other environment's frontend and admin with credentialed responses — dev
accepted `meetifyy.app`, `www.` and `admin.`; production accepted `dev.` and
`dev-admin.`. Nothing errored; every request simply worked.

**List each environment's exact origins. Never `*`, never a pattern over
`.meetifyy.app`.** `FRONTEND_URL`, `ADMIN_URL` and the installed app's
`https://localhost` are added automatically, so:

| | `CORS_ORIGINS` | `CORS_ORIGIN_PATTERNS` |
|---|---|---|
| development | `https://dev.meetifyy.app,https://dev-admin.meetifyy.app` | *(unset)* |
| production | `https://meetifyy.app,https://www.meetifyy.app` | *(unset)* |

`isolation.guard.ts` refuses to boot when CORS admits a host under
`COOKIE_DOMAIN` that belongs to another environment, judging a pattern by what
it can match, and refuses `*` on the credentialed API. It runs in development
as well as production; a deployment with no `COOKIE_DOMAIN` is not inspected.
The allowlist is not a reflector: unknown origins (e.g.
`https://evil.example.com`, `null`) get no `Access-Control-Allow-Origin`. A
refused preflight answers 404. Requests with **no** `Origin` header are allowed
(they are not browser cross-origin requests).

Check a deployed API with a preflight:

```bash
curl -s -o /dev/null -D - -X OPTIONS https://dev-api.meetifyy.app/api/auth/session -H "Origin: https://meetifyy.app" -H "Access-Control-Request-Method: GET" | grep -i access-control-allow-origin
```

No output means refused, which is the correct answer for that pair. The API
also accepts the `sentry-trace` and `baggage` headers
([OBSERVABILITY.md](OBSERVABILITY.md#trace-propagation)). R2 bucket CORS is
separate: [INFRASTRUCTURE.md](INFRASTRUCTURE.md#storage-r2).

## 7. Content Security Policy and headers

Enforced: `frame-ancestors 'none'`, `base-uri`, `form-action`, `object-src
'none'`, no `unsafe-eval` (verified: no `eval`/`new Function` in the built
assets; the one `Function("return this")` is the globalThis polyfill behind a
short-circuit), HSTS, `X-Content-Type-Options`, `Referrer-Policy`,
`Permissions-Policy`. The CSP lives in **both** `vercel.json` files (root and
`frontend/`), which must agree. Never disable CSP or HSTS in production.
`connect-src` allows the Sentry ingest hosts
([OBSERVABILITY.md](OBSERVABILITY.md#website)).

### Staged, not enforced (report-only)

Two tightenings ship as `Content-Security-Policy-Report-Only` beside the
enforced policy; browsers evaluate and report, nothing is blocked. Tests pin
that the candidate cannot drift weaker than what is enforced.

| | Why not enforced yet |
|---|---|
| **`script-src` without `unsafe-inline`** | Allows each inline script in `index.html` by its sha256. Blocked by Cloudflare JavaScript Detections (below). |
| **`connect-src` narrowed to named hosts** | Currently allows `http:`/`https:` outright, so CSP cannot constrain exfiltration. Narrowing depends on the full runtime host set; miss one and uploads or sign-in break in production. |

**To finish:** load the app in a browser, exercise login, upload, chat and
realtime, and watch the console for CSP violations. Clean → copy the
report-only value over the enforced one and delete the report-only header.
Verified 2026-09-23: with the report-only value served as the **enforced**
policy, `/`, `/login`, `/signup` and `/home` all boot locally with zero
violations.

**Blocker — Cloudflare JavaScript Detections.** Cloudflare injects an inline
script at the edge (`window.__CF$cv$params`, then
`/cdn-cgi/challenge-platform/scripts/jsd/main.js` from an iframe). Its body
carries a per-request ray id and timestamp, so no hash can ever match it.
Cloudflare's documented support is a **nonce in the CSP response header**, which
it copies onto what it injects; it does not work with hashes or with a
`<meta>` CSP, and JS Detections cannot be switched off under Bot Fight Mode.
Bot Fight Mode was turned off on 2026-11-12, so JS Detections can now be
switched off in the dashboard (Security → Bots); it was still on that day.
Decide first: a per-request nonce (edge middleware, which ends static caching
of the HTML), turning JS Detections off (Super Bot Fight Mode only), or
accepting that it is blocked.

### Inline scripts must be byte-identical across builds

Two things once kept the hash list stale:

- The Vite plugin meant to patch it read `dist/app.html` in `closeBundle`, but
  that file is written by `prerender-seo.mjs` after `vite build`. It returned
  silently on every build and never patched anything.
- The version gate carried the commit SHA in its own text, so its hash changed
  on every commit.

The build stamp now lives in the `meetifyy-build` meta tag. Rules:

- Never put anything that varies per build inside an inline script.
- When you edit one, run `npx vitest run src/config/__tests__/cspReportOnly.test.js`
  in `frontend/`: it prints the exact list to paste into **both** `vercel.json`
  files and requires an exact match.
- `scripts/verify-csp-hashes.mjs` fails the build if a built page ships a
  script the policy does not hash.
- Never make the build rewrite tracked files to keep them in sync.

## 8. Email change security

How Settings → Email (sign-in email) and the Campus college email are
protected: fresh reauthentication, ownership proof, independent 30-day
cooldowns, and a database guard on Supabase Auth's own email-change path.
Feature-level behaviour is in
[FEATURES_AND_FLOWS.md](FEATURES_AND_FLOWS.md#personal-email-and-email-changes).

### The three operations

| Operation | Reauth grant purpose | Ownership proof | Cooldown |
|---|---|---|---|
| Change sign-in (personal) email | `personal_email_change` | 6-digit code to the **new** address | personal, 30 × 24 h |
| Add / change college email | `college_email_change` (not for an account's first-ever one) | 6-digit code to the college address, on an ACTIVE domain of that college | college, 30 × 24 h |
| Remove college email | `college_email_remove` | — | never blocked; restarts the college cooldown |

The two cooldowns are separate rows in `EmailChangeEvent`; neither moves the
other. Super Admin revoke / reset are recorded (`ADMIN_REVOKE`,
`ADMIN_RELEASE`) but start no cooldown and are never blocked by one.

### Reauthentication grants

`/api/account/reauth` (`account-security/reauth.*`; routes in
[BACKEND_AND_API.md](BACKEND_AND_API.md#reauthentication-apiaccountreauth)):

- `GET` → `{ methods }`: `password` when the Supabase user has an `email`
  identity, otherwise `email_code` (OAuth / passwordless accounts), which
  sends a code to the **current** sign-in address. A password account cannot
  use the email path.
- A grant is 256 random bits; only its SHA-256 is stored (`ReauthGrant`). It is
  bound to the user, the purpose, the session id (the `<prefix>_sid` cookie,
  or `x-session-id` from the app), and the address its live code was sent to
  (bound only after that code is issued, so "use a different email" needs no
  second prompt and a refused resend cannot move it). It lives 10 minutes, one
  live grant per (user, purpose), and is spent by a conditional update inside
  the transaction that applies the change — so exactly one concurrent request
  can spend it, and a rolled-back change leaves it spendable. The server never
  accepts a flag, a timestamp or an existing session as proof.
- Password checks go through `AuthService.verifyPassword` (Supabase), which
  checks against the **current** auth email (Supabase admin `getUserById`, then
  `User.email`, then the token claim — so a token issued before a
  personal-email change still works), and spend the
  `auth.verifypassword.user` budget (5 / 15 min, fails closed without Redis):
  on `/reauth/password`, and inside the services for the legacy password
  bodies below. A verify or removal that carries a grant guesses no password
  and spends none; code guesses are capped per code and per IP by
  `UserOtpService`.
- Independent pre-checks run in parallel (`allChecks`); when several fail the
  first listed wins, so a refused request always gets the same answer.
- In the UI, Settings asks "confirm it's you" as soon as the change form opens
  (`reauthFirst`); the profile-completion card asks only on "Send code", so the
  app never opens a password dialog unprompted.

**Installed apps that predate grants** send `{ code, currentPassword }` to
`/api/account/email/verify` and `{ password }` to
`DELETE /api/campus/affiliation`. Both are still accepted: the password is
re-checked at that commit point, which is a fresh reauthentication. Old builds
**cannot change a college email** any more (they send no credential, so the
server answers `reauth_required` with a readable message). First-time Campus
verification still works on them.

### Cooldown enforcement

`EmailChangePolicyService`:

- Every completing write locks the user row (`SELECT … FOR UPDATE`), re-checks
  the cooldown against `timezone('utc', now())`, applies the change and
  appends the event — one transaction. Two devices therefore serialise; the
  second is refused.
- The cooldown is also checked before any code is sent and before a code is
  consumed, so a doomed attempt costs no code.
- Nothing is recorded for a failed, abandoned, expired or rolled-back attempt.
- Accounts with no history are eligible.

### The sign-in email and Supabase Auth

A signed-in client holds a Supabase access token and the public anon key, so it
could call `PUT /auth/v1/user {"email": …}` directly and skip all of the above.
Supabase has no setting that disables user-initiated email changes, so
migration `00000000000029_email_change_security` installs a `BEFORE UPDATE`
trigger on `auth.users` (`meetifyy_guard_auth_email_change`) that:

1. refuses any non-empty write to `email_change` (where GoTrue stages a
   self-service change before its confirmation mail), and
2. refuses any change of `email` unless a live `AuthEmailChangeIntent` row
   names exactly that address for that user.

The backend flow (`AccountEmailService.verify`): lock → re-check cooldown,
uniqueness, in-flight intent → spend grant → write a 60-second intent → commit
→ `auth.admin.updateUserById` → lock → `User.email` + event + delete intent →
commit → enqueue the notice to the **previous** address (job id = event id, 5
attempts with backoff). If the row write fails the auth email is restored
(under a fresh intent). If the admin call errors in a way that may still have
applied (a timeout), the intent is kept: once it expires, `reconcile()` reads
Supabase and finishes the change or clears it. The same happens after a crash
between the two halves. A duplicate completion is a no-op because the intent is
gone, and a request that finds the reconciler already finished its change
returns success instead of undoing it. The intent cascades with the account,
so a deletion mid-change leaves no addresses behind.

The profile `PATCH /api/users/me` never writes `email`, and the auth sync path
writes it only when creating a new account.

### Deployment checklist (per project)

1. **Confirm the trigger exists after the migration runs** (query in
   [DATABASE.md](DATABASE.md#useful-checks)). If the migrating role could not
   create it, the migration still succeeds (with a `WARNING`) so it cannot block
   later migrations, and the API logs an `ERROR` from `AuthEmailGuardCheck` at
   boot. Install it from the SQL editor by re-running the `DO $$ … $$` block at
   the end of the migration.
2. **Smoke-test the bypass in development** with a test account: call
   `PUT https://<dev-ref>.supabase.co/auth/v1/user` with the account's access
   token and `{"email":"x@example.com"}`. Expect an error response and no
   confirmation email; the account's email must be unchanged.
3. Nothing to change in Supabase Auth settings, the email provider, or
   environment variables.

### Tests

- Unit: `account-email.service.spec.ts`, `campus-affiliation.service.spec.ts`
  (grants and cooldowns stubbed).
- Database-backed: `account-security/email-change.db.spec.ts` runs the real
  services against Postgres with the migrations applied and a Supabase-shaped
  `auth.users`; auth writes run as `supabase_auth_admin`, so the trigger judges
  them as in Supabase. Setup rules: [DATABASE.md](DATABASE.md#5-testing-against-a-real-postgres).

### Known limits

- Verified against Postgres, not against a live GoTrue: the exact HTTP error a
  client gets from `PUT /auth/v1/user` when the trigger refuses is GoTrue's
  (`Database error updating user`).
- No OAuth provider is configured today, so `email_code` reauthentication is
  exercised only in tests.

## 9. Protecting stored data

- Identity documents and conversation media live in the **private** R2 bucket
  ([INFRASTRUCTURE.md](INFRASTRUCTURE.md#storage-r2)). Conversation media is
  protected at four layers, because three are individually bypassable: the
  media route authorizes participation; uploads are born private; signed URLs
  authorize **participants, not just owners**; and objects live in the bucket
  with no public host (without that last one the rest is decoration, since
  `cdn.meetifyy.app` resolves any key unauthenticated). This was only possible
  after the cookie migration: an `<img>` tag cannot send an Authorization
  header.
- The Supabase Data API is locked down (migration 30,
  [DATABASE.md](DATABASE.md#3-supabase-data-api-postgrest)).
- Admin OTPs are keyed HMACs with constant-time comparison; admin bcrypt cost
  is 12; admin auth has per-IP *and* per-account limits, a 5-attempt OTP
  lockout, CSRF double-submit, HttpOnly cookies and revocation.
- Push payloads, Sentry events and logs never carry message/post text, emails,
  tokens or endpoints ([FEATURES_AND_FLOWS.md](FEATURES_AND_FLOWS.md#payload-privacy),
  [OBSERVABILITY.md](OBSERVABILITY.md#privacy)).
- Error responses are generic for 5xx; stacks stay server-side; sensitive
  field names are redacted in logs.
- `link-preview.service.ts` blocks SSRF: IPv4-mapped IPv6 addresses are
  normalised so private/metadata ranges (incl. `169.254.169.254` and
  `100.64.0.0/10`) are defined once and blocked in both forms.
- Path traversal: a regex plus an independent containment check. Every raw SQL
  query is a static literal.

## 10. Rules: do not weaken security to make something work

If a change requires disabling a protection, stop and explain the trade-off
instead. In particular, never:

- add `*` to `CORS_ORIGINS`, or any pattern spanning `.meetifyy.app`;
- disable CSP or HSTS in production;
- set `R2_VERIFICATION_BUCKET_NAME` to the public bucket, or give the private
  bucket a public host;
- change Redis `maxmemory-policy` away from `noeviction`;
- enable the ACR admin user on production;
- use `Math.random` for a token, id, secret or lock value;
- add `pgbouncer=true` or `sslmode=require` to the database URLs;
- add `@AllowBearerToken` to another route;
- put a secret in a `VITE_` variable or a real credential in a `.example` file.

Before any commit that touches config or docs, grep the diff for live values:
connection strings, `eyJ…` JWTs, `sb_secret_…`, `re_…` and 32-hex account
IDs. A production database password once reached a docs file as an "example"
and was caught only by a pre-push scan. Never print a secret into a terminal,
log, commit message or document; mask it.

## 11. Open security items

| Item | State |
|---|---|
| CSP `script-src` / `connect-src` enforcement | Report-only; blocked on the Cloudflare JS Detections decision (§7). |
| Origin header check (`ORIGIN_AUTH_SECRET`) | Code shipped 2026-11-12, **not active**: needs the secret on the production Container App and the Cloudflare rule that adds the header. Until then the origin trusts any request arriving from a Cloudflare address, including another customer's zone. ([INFRASTRUCTURE.md](INFRASTRUCTURE.md#origin-protection-production-api)) |
| Development API at the edge | `dev-api.meetifyy.app` is DNS-only: no WAF, no edge rate limit, origin open. |
| Chat media uploaded before commit `bc60f39` | Still on the public CDN and reachable by URL. New uploads go private; old objects do not move themselves. Closing it means copying them into the private bucket and repointing their `media` rows, or removing the public bucket's host. Infrastructure action. |
| Old Supabase project `aqeivtmrdyabfaddpjon` | Confirm it is deleted. Its anon key is in git history (commit `6f117e2`, removed in `770c257`); low severity unless a live project with weak RLS sits behind it. |
| Legacy bearer path | `@AllowBearerToken` remains on the two signup-handover routes; the original audit noted the pre-cookie bearer path was kept so old clients were not signed out on deploy, to be removed once traffic moved over. Verify current state before changing. |
| Live attack testing | Never performed: manipulated JWTs against a running server, cross-user IDOR probing with real accounts, socket events from a real client, guessed media URLs, CSP enforcement in a browser. A staging IDOR sweep across the user-JWT endpoints is the highest-value next step. |
| Security posture of the 2026-09-09 audit | Static analysis plus tests at each boundary (pre-fix code shown accepting the attack input, post-fix rejecting it); not an authenticated end-to-end probe. Full report in [ENGINEERING_LOG.md](ENGINEERING_LOG.md#security-audit-and-remediation--2026-09-09). |
