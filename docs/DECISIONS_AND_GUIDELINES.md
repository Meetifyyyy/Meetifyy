# Decisions and guidelines

The rules every change must follow, and the technical decisions behind the
current design — with the reason, so nobody reverses one by accident.

For AI coding agents, the binding versions of the rules are `CLAUDE.md` (root)
and `.agents/AGENTS.md` (mobile §6b–6f); where this document summarises them,
those files win. If a rule blocks you, **stop and ask** — do not route around
it.

---

## 1. Working rules

### Environments and production

- Never write to the production database — not through the Supabase MCP,
  `psql`, a script, or "just this once". Its schema is owned by
  `prisma migrate deploy` run by CI ([DATABASE.md](DATABASE.md)).
- Never edit production env files or Azure secrets unless that exact change
  was asked for. Never run `setup-azure-prod.sh`, bind a domain, or delete an
  Azure resource unasked.
- Development and production never touch: no shared values, resources, Redis,
  GitHub environments or Supabase MCP sessions
  ([INFRASTRUCTURE.md](INFRASTRUCTURE.md#isolation-rules)).
- CI/CD owns deployment; nothing is shipped by hand
  ([INFRASTRUCTURE.md](INFRASTRUCTURE.md#4-cicd-and-the-deploy-pipeline)).

### Database

- Never `prisma db push`. Never `migrate dev`/reset/shadow against a shared
  database. Commit schema and migration together; migrations must build from
  empty and stay backward-compatible with the previous release
  ([DATABASE.md](DATABASE.md#rules)).

### Secrets

- Only `*.example` files are committed; never a real credential in one.
- Never put a secret in a `VITE_` variable (it ships in the bundle).
- Grep every config/docs diff for live values before committing; never print
  a secret unmasked ([SECURITY.md](SECURITY.md#10-rules-do-not-weaken-security-to-make-something-work)).

### Security

Do not weaken a protection to make something work; explain the trade-off
instead. The list of things never to do (CORS patterns, CSP/HSTS, private
bucket, Redis eviction, ACR admin, `Math.random` tokens, DB URL flags,
`@AllowBearerToken`) is in [SECURITY.md](SECURITY.md#10-rules-do-not-weaken-security-to-make-something-work).

### Code

- Backend: no `any`, lint at zero, typed tests
  ([BACKEND_AND_API.md](BACKEND_AND_API.md#2-type-safety-and-lint-blocking-at-zero)).
- Frontend: respect the core/platform boundary
  ([ARCHITECTURE.md](ARCHITECTURE.md#the-core--platform-boundary)); use
  foldable build constants (`IS_MOBILE_BUILD`) for platform-only code.
- APIs that an installed app calls change only additively
  ([MOBILE_APP.md](MOBILE_APP.md#1-what-an-installed-app-is)).
- Typography: compose the semantic classes in `frontend/src/styles/`
  (`styles/README-typography.md`) rather than hand-picking sizes and weights.
- Rate limits: values in `rate-limit.config.ts` only, with a
  `POLICY_VERSION` bump ([BACKEND_AND_API.md](BACKEND_AND_API.md#9-rate-limiting)).

### Git

- The repository owner is the only author: no `Co-Authored-By`, "Generated
  with" or other attribution trailers in commits or PRs.
- Never force-push a shared branch or rewrite pushed history.
- Never commit directly to `main` (it deploys production). Do not push, merge
  or open a PR unless asked.
- New durable docs under `docs/` must be added to the `.gitignore` allow-list
  (`docs/*` is ignored, then each tracked doc is re-included); otherwise
  `git add` skips them silently — that is how a README once linked a file that
  was never pushed.

### Verification and reporting

- Read the code rather than assuming; config lives in `backend/src/config/`.
- Run the tests and lint ([DEVELOPMENT_GUIDE.md](DEVELOPMENT_GUIDE.md#4-checks-to-run)).
- Report failures with output, say what was skipped and why, and never report
  success that was not verified. Distinguish a real finding from a false
  positive.
- **Verify, don't reason.** Measure infrastructure behaviour (hop counts, CORS,
  caching, on-device timings) instead of inferring it; several wrong
  conclusions in this project came from reasoning.
- Diagnose auth failures from the dev API logs and Supabase auth logs first.
- For WebView/native problems, search upstream issues and documentation early
  for the root cause.

---

## 2. Decision record

Each row is a decision currently in force. Dates are when it was made or last
confirmed; the evidence is in the linked document or
[ENGINEERING_LOG.md](ENGINEERING_LOG.md).

### Platform and infrastructure

| Decision | Why | Details |
|---|---|---|
| Dev and prod in separate Azure subscriptions, Microsoft accounts, Supabase projects, Cloudflare accounts, Redis instances, Sentry orgs | A subscription may hold only one Container Apps environment; and isolation at every layer | [INFRASTRUCTURE.md](INFRASTRUCTURE.md#1-environments) |
| Migrations run as a Container App Job, before the new image | Keeps the prod DB URL out of GitHub; schema always ≥ code | [INFRASTRUCTURE.md](INFRASTRUCTURE.md#4-cicd-and-the-deploy-pipeline) |
| Deploys wait for CI `validate`; Vercel waits for the API | A failed-CI commit was once deployed; a fast frontend can sign users out against an old API | same |
| `@prisma/adapter-pg`; no `pgbouncer=true`, no `sslmode=require`; pooler for both URLs | Driver behaviour and Azure's lack of IPv6 | [DATABASE.md](DATABASE.md#connection-strings) |
| Migration history rebuilt; `db push` banned | The old history could not build a database from empty | [DATABASE.md](DATABASE.md#never-prisma-db-push) |
| Redis is a queue store, `noeviction`, never shared | Evicting a job deletes promised work | [INFRASTRUCTURE.md](INFRASTRUCTURE.md#redis) |
| Production Redis is a self-hosted container hardened with `maxmemory`, RDB snapshots on Azure Files and a liveness probe, not Azure Cache | Fixed student credit; Basic tier has no persistence, Standard costs more | [INFRASTRUCTURE.md](INFRASTRUCTURE.md#production-redis) |
| Application email: Resend primary, Brevo SMTP failover only when Resend reports "not sent"; Supabase Auth mail through Brevo | Two providers for resilience; never duplicate a mail on an ambiguous failure | [INFRASTRUCTURE.md](INFRASTRUCTURE.md#email) |
| `dev.meetifyy.app`, `dev-admin.meetifyy.app` and `admin.meetifyy.app` behind Cloudflare Access | Subdomains are public via Certificate Transparency; obscurity is not access control | [INFRASTRUCTURE.md](INFRASTRUCTURE.md#6-access-control-on-hosts) |
| Production has its own ACR (admin user off) and pulls with a user-assigned AcrPull identity | Dev deletion/lockdown must not stop production; no shared static credential | [INFRASTRUCTURE.md](INFRASTRUCTURE.md#azure-resources) |
| R2 only (`STORAGE_PROVIDER` single value); private bucket for `verification/` and chat media | Fail loudly; identity documents never public | [INFRASTRUCTURE.md](INFRASTRUCTURE.md#storage-r2) |
| No immutable cache header on `/assets/*` by pathname | Vercel rules also match missing files | [INFRASTRUCTURE.md](INFRASTRUCTURE.md#vercel-caching-and-stale-chunks) |
| Exact-origin CORS, environment-prefixed cookies (incl. admin) | `.meetifyy.app` is shared by both environments | [SECURITY.md](SECURITY.md#6-cors) |

### Auth and security

| Decision | Why | Details |
|---|---|---|
| Revocable server sessions; HttpOnly cookies on web; provider refresh token sealed server-side | Tokens in `localStorage` were unrevocable | [SECURITY.md](SECURITY.md#2-sessions) |
| Installed app: session-bound bearer (`x-session-id`), tokens in body only for the native **Origin** (Option A); `SameSite=None` rejected (Option B) | Cross-site WebView cannot store `Strict` cookies; a bare bearer would bypass revocation | [SECURITY.md](SECURITY.md#3-the-installed-app-session-bound-bearer-tokens) |
| `https://localhost` allowed by default in code (`DEFAULT_NATIVE_APP_ORIGINS`) | The one exception to "nothing baked into the code": it is fixed by `capacitor.config.json`, identical everywhere, owned by nobody; allowing it does not authenticate it | [SECURITY.md](SECURITY.md#the-apps-origin-and-cors) |
| Access token persisted in Keystore beside the refresh token (2026-10-05) | Reversed the earlier "fewer copies of a secret" design after measuring cold-start cost and rotation sign-outs; no added exposure | [SECURITY.md](SECURITY.md#what-was-built-option-a) |
| Lost-rotation recovery: immediate parent only, unused successor, < 60 s | Lost responses are indistinguishable from theft; stricter than a reuse window | [SECURITY.md](SECURITY.md#2-sessions) |
| Rate-limit values are literals, identical in every environment; `shadow` mode refused in production | Env-var limits get weakened in incidents | [BACKEND_AND_API.md](BACKEND_AND_API.md#9-rate-limiting) |
| `TRUST_PROXY_HOPS=2`, with `api` proxied through Cloudflare | Measured (2026-11-12); the earlier "3 when proxied" was reasoning and was wrong | [BACKEND_AND_API.md](BACKEND_AND_API.md#trust_proxy_hops) |
| Production origin accepts Cloudflare's ranges only; Bot Fight Mode off | The Azure hostname bypassed the edge and honoured forged client addresses; Bot Fight Mode challenged Vercel's calls to the API | [INFRASTRUCTURE.md](INFRASTRUCTURE.md#origin-protection-production-api) |
| Reauthentication grants + 30-day cooldowns + `auth.users` trigger for email changes | A client could otherwise change its auth email directly at Supabase | [SECURITY.md](SECURITY.md#8-email-change-security) |
| SVG logos rejected | `/api/media/*` serves from the API origin with no sanitizer | [BACKEND_AND_API.md](BACKEND_AND_API.md#admin-colleges-and-affiliation) |
| CSP hashes maintained by hand + test, never patched by the build; build stamp in a meta tag | The patching plugin silently never ran | [SECURITY.md](SECURITY.md#inline-scripts-must-be-byte-identical-across-builds) |
| Supabase Data API locked (RLS, no grants) | Anyone with the anon key could read and write every table | [DATABASE.md](DATABASE.md#3-supabase-data-api-postgrest) |

### Product

| Decision | Why | Details |
|---|---|---|
| Open signup; Campus via verified college email (`CollegeAffiliation`); selfie gate narrowed to messaging, creating posts/communities/activities and Instant Match | Separate login, identity verification and campus membership | [FEATURES_AND_FLOWS.md](FEATURES_AND_FLOWS.md#1-signup-campus-and-college-email) |
| College email local part kept as typed (no dot/plus stripping) | Institutions differ | same |
| Old apps get a version *nudge*, not a forced update, for additive changes | Nothing broken enough to force | [MOBILE_APP.md](MOBILE_APP.md#version-gate) |
| Push is derived, best-effort (no outbox); text only in `push-payload.ts`; who/what only | A push must never fail an action or leak content | [FEATURES_AND_FLOWS.md](FEATURES_AND_FLOWS.md#2-push-notifications) |
| Android channels `messages`/`social`/`activity`/`community` and icon `ic_stat_notify` are permanent | Contracts with every installed build | same |
| New `COMMUNITY_JOIN*` notification types, not `JOIN_REQUEST` | Old clients render `JOIN_REQUEST` as "joined the activity" | same |
| Web service worker only on production hosts | Cloudflare Access on dev; deliberate | same |
| Legal text in the frontend, published to the DB by migrations | One source of truth; acknowledgement triggered from the admin portal | [FEATURES_AND_FLOWS.md](FEATURES_AND_FLOWS.md#help-and-legal-copy) |

### Installed app

| Decision | Why | Details |
|---|---|---|
| The app wraps the real website (a separate rebuilt mobile UI was reverted) | The site already exists and is responsive | [MOBILE_APP.md](MOBILE_APP.md) |
| Native projects committed | Store releases hand-edit them | same |
| No service worker in the app | A WebView SW could serve the deployed site instead of the reviewed bundle | same |
| Socket.IO polling-first | Campus proxies hang WebSocket attempts | [BACKEND_AND_API.md](BACKEND_AND_API.md#4-realtime-socketio) |
| Socket released after 30 s hidden, not `KeepRunning=false` | Keeps timers for in-flight uploads | [MOBILE_APP.md](MOBILE_APP.md#3-auth-and-lifecycle-on-the-device) |
| Sentry loaded after first screen on Android | Was ~22% of the entry chunk and delayed auth by ~360 ms; native crashes in the first second or two are not caught (accepted) | [OBSERVABILITY.md](OBSERVABILITY.md#android-app) |
| Keyboard overlays the page; the WebView never resizes; the page lifts itself on one `meetifyy:ime` event per transition (2026-10-13) | Resizing the WebView, at once or per frame, cost 60–90 ms restyles per step and showed blank strips | [MOBILE_APP.md](MOBILE_APP.md#4-native-ui-behaviour) |
| No `animation-timeline` in app code | Scroll-driven animations stall flings in the WebView | [MOBILE_APP.md](MOBILE_APP.md#4-native-ui-behaviour) |
| Portrait-only everywhere, including video fullscreen (2026-11-04) | Owner decision | [MOBILE_APP.md](MOBILE_APP.md) |
| Page transitions never scale the live WebView or shrink a page | Owner decision after experiments | [MOBILE_APP.md](MOBILE_APP.md#4-native-ui-behaviour) |

### Open decisions (owner)

| Question | Options |
|---|---|
| Enforcing CSP `script-src` with Cloudflare JS Detections | per-request nonce (ends static HTML caching), turn JS Detections off (Super Bot Fight Mode), or accept it blocked |
| Old public chat media (before `bc60f39`) | move objects to the private bucket and repoint rows, or remove the public host |
| R8 / resource shrinking for release APKs | needs a release smoke test on a device |
| Rate-limit gaps (likes/follows, reports, search quotas, socket concurrency, email ceiling, WAF, alerts) | [BACKEND_AND_API.md](BACKEND_AND_API.md#not-implemented-yet) |
| Uptime monitoring | Sentry Uptime or an Azure availability test on `/health` |
