# Meetifyy documentation

The source of truth for how Meetifyy is built, run, deployed and secured.
Start with the overview, then read the document for the area you are about to
touch.

## Documents

| Document | Read it when |
|---|---|
| [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md) | You are new: what the product and repository contain, features, terminology. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | You need the system picture, the technical stack, or the frontend core/platform boundary. |
| [DEVELOPMENT_GUIDE.md](DEVELOPMENT_GUIDE.md) | Setting up, running locally, testing, contributing. |
| [BACKEND_AND_API.md](BACKEND_AND_API.md) | Changing the API: layout, type-safety rules, queues, realtime, uploads, **rate limiting**, endpoint contracts. |
| [DATABASE.md](DATABASE.md) | Touching `schema.prisma`, migrations, connection strings or the Supabase Data API. |
| [INFRASTRUCTURE.md](INFRASTRUCTURE.md) | **Before changing anything in production**: environments, isolation, CI/CD, Redis, email, R2, DNS, caching, MCP. |
| [SECURITY.md](SECURITY.md) | Auth, sessions, the app's bearer sessions, CORS, cookies, CSP, email-change security, open security items. |
| [FEATURES_AND_FLOWS.md](FEATURES_AND_FLOWS.md) | Signup / Campus / college email, verification gates, push notifications. |
| [MOBILE_APP.md](MOBILE_APP.md) | The installed Android app: builds, device testing, startup, performance state. |
| [OBSERVABILITY.md](OBSERVABILITY.md) | Sentry (web, Android, API), logs, rate-limit telemetry, the uptime gap. |
| [DECISIONS_AND_GUIDELINES.md](DECISIONS_AND_GUIDELINES.md) | The rules for every change and the decisions behind the design. |
| [ENGINEERING_LOG.md](ENGINEERING_LOG.md) | Dated evidence: device runs, root-cause write-ups, the security audit and performance reports. |

`INFRASTRUCTURE.md` is the one that saves time. Most of its entries are real
failures that already happened, and they share a shape: nothing errors at the
time, and you find out later — in a user's inbox, or five deploys into an
outage.

## Reading paths

- **New developer:** PROJECT_OVERVIEW → ARCHITECTURE → DEVELOPMENT_GUIDE →
  DECISIONS_AND_GUIDELINES.
- **Backend change:** BACKEND_AND_API → DATABASE (if the schema changes) →
  SECURITY (if it touches auth or user data).
- **Installed-app change:** MOBILE_APP → `.agents/AGENTS.md` §6b–6f →
  SECURITY §3.
- **Infrastructure or deploy change:** INFRASTRUCTURE → DECISIONS_AND_GUIDELINES.

## Agent instructions

AI coding agents are bound by `CLAUDE.md` (root), `AGENTS.md` and
`.agents/AGENTS.md`. Those files are maintained separately and win over any
summary here.

## Documentation kept elsewhere

| File | Content |
|---|---|
| `frontend/src/styles/README-typography.md` | Typography tokens and semantic classes. |
| `frontend/src/__perf__/README.md` | The render-cost harness (`npm run perf`) and its baselines. |
| `frontend/src/features/auth/landing/assets/CREDITS.md` | Landing-page photo credits (Unsplash). |
| `frontend/ios/App/CapApp-SPM/README.md` | Capacitor-generated; do not modify. |
| `.env.example`, `*/.env.example`, `*/.env.production.example` | The annotated variable lists for each app. |
| `docs/private/` | Local-only documents — Azure provisioning notes (`azure-setup.md`), the cache/sync audit and app-caching research, the 2026-10-19 UI/push implementation report, and the backend lint audit with its tools. Git-ignored and never committed (the repository is public). |

## Old document paths

Earlier documents were consolidated here and removed. Three paths remain as
short pointers because already-applied migrations cite them, and an applied
migration can never be edited:

| Old path | Now |
|---|---|
| `docs/college-affiliation.md` (cited by migrations 14–16) | [FEATURES_AND_FLOWS.md](FEATURES_AND_FLOWS.md#1-signup-campus-and-college-email), [DATABASE.md](DATABASE.md#6-rollback-sql-for-migration-14) |
| `docs/email-change-security.md` (migration 29) | [SECURITY.md](SECURITY.md#8-email-change-security) |
| `docs/push-notifications.md` (migration 18) | [FEATURES_AND_FLOWS.md](FEATURES_AND_FLOWS.md#2-push-notifications) |

Removed: `docs/techstack.md` → ARCHITECTURE; `docs/project-structure.md`,
`docs/operations.md` → INFRASTRUCTURE (+ DATABASE, SECURITY);
`docs/rate-limiting.md` → BACKEND_AND_API; `docs/mobile-auth-decision.md` →
SECURITY §3 and the log; `docs/sentry.md` → OBSERVABILITY;
`docs/testing-log.md`, `SECURITY-AUDIT.md`, `PERFORMANCE_AUDIT.md`,
`PERFORMANCE_OPTIMIZATION.md` → ENGINEERING_LOG (verbatim).

## Maintaining these documents

- Keep each fact in one place and link to it.
- Mark planned or unverified work as such, with a date.
- `docs/*` is git-ignored except for files re-included in `.gitignore`; add a
  new durable document there or `git add` will skip it silently.
- Anything that must never be committed goes in `docs/private/`.
