# Development guide

Setting up, running, testing and contributing. Read
[DECISIONS_AND_GUIDELINES.md](DECISIONS_AND_GUIDELINES.md) for the rules that
apply to every change.

---

## 1. Prerequisites

- Node.js **≥ 22** (root `package.json` `engines`).
- Development credentials for the DEV Supabase project, dev R2 bucket and a
  Redis you can run locally. Never use production values locally.
- For the Android app: the JDK 21 + Android SDK toolchain in
  [MOBILE_APP.md](MOBILE_APP.md#toolchain-on-this-machine).

## 2. First run

```bash
npm install
cp backend/.env.example        backend/.env.local
cp frontend/.env.example       frontend/.env.local
cp admin-frontend/.env.example admin-frontend/.env.local
# fill in development credentials, then:
npm run dev:services
```

`dev:services` runs, in one terminal with labelled output: Mailpit, the backend
(`start:dev`), the web frontend, the admin portal and the mobile dev server.
Individual targets: `npm run dev:backend`, `dev:frontend`, `dev:admin`,
`dev:mobile`, `mailpit`. (`npm run dev` delegates to the git-ignored
`local/start.sh`.)

| Service | Local address |
|---|---|
| API | `http://localhost:4000` |
| Web frontend | `http://localhost:3000` |
| Mobile dev server | `http://localhost:3001` |
| Admin portal | `http://localhost:5174` |
| Mailpit UI (SMTP on 127.0.0.1:1025) | `http://localhost:8025` |

Mail goes to Mailpit instead of real inboxes (`EMAIL_DRIVER=mailpit`;
`DEV_EMAIL_REDIRECT` can force every message to one address). Local backend
settings that differ from deployed ones (`backend/.env.development.example`):
`COOKIE_SECURE=false`, `COOKIE_SAME_SITE=lax`, blank `COOKIE_DOMAIN`,
`CORS_ALLOW_LOCAL_NETWORK=true`, `TRUST_PROXY_HOPS=0`, `LOG_PRETTY=true`,
`LOG_QUERIES=true`, `FEATURE_DEV_ENDPOINTS=true`. The web dev server proxies
the API through `VITE_DEV_API_PROXY_TARGET` (default `http://127.0.0.1:4000`);
`VITE_API_PREFER_LOCAL` (on for dev builds) makes a page served from
localhost/LAN talk to a backend on that same host. The Mailpit binary lives at
`local/bin/mailpit` (not committed).

How the environment files load, and what may and may not be committed:
[INFRASTRUCTURE.md](INFRASTRUCTURE.md#3-configuration-and-environment-files).
Every `.env.example` / `.env.production.example` is the annotated list of
variables for its app. Remember that anything loading `backend/src/config`
reads `.env.local` and `.env.development`, so it is pointed at development.

## 3. Contribution flow

```
1. branch from development        git switch -c feature/your-change development
2. commit                         schema + migrations together, always
3. push, open a PR into development
4. CI must pass, then merge       → DEV deploys, DEV migrations run
5. test on dev.meetifyy.app
6. open a PR: development → main
7. review, then merge             → PROD deploys, PROD migrations run
```

Both deploys are automatic on merge; nothing is deployed by hand
([INFRASTRUCTURE.md](INFRASTRUCTURE.md#4-cicd-and-the-deploy-pipeline)).
Database changes always go through a committed migration
([DATABASE.md](DATABASE.md#2-migrations)).

## 4. Checks to run

### Backend (`backend/`)

```bash
npm run lint && npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.tooling.json && npx jest
```

Lint is blocking at zero warnings with no suppressions; the type-safety rules
are in [BACKEND_AND_API.md](BACKEND_AND_API.md#2-type-safety-and-lint-blocking-at-zero).
Database-backed specs need a local PGlite/Postgres URL
([DATABASE.md](DATABASE.md#5-testing-against-a-real-postgres)).

### Frontend (`frontend/`)

```bash
npm test
npm run typecheck
npx eslint .
```

The mobile/core boundary rules are lint errors, so passing tests alone do not
mean the architecture held. In CI the boundary lint
(`npx eslint src/core src/platform --max-warnings 0`) and `npm run typecheck`
are blocking; the full frontend lint still runs with `continue-on-error`
because of an older warning backlog. `npm run perf` runs the render-cost
harness (`src/__perf__/README.md`).

### Admin frontend (`admin-frontend/`)

`npm run lint` (Oxlint) and `npm run build`.

### Standing checks for frontend changes

From the mobile/core programme; still the way to prove a refactor did not
change the website:

| # | Check | Command | Must be |
|---|---|---|---|
| S1 | Unit tests | `cd frontend && npm test` | all green |
| S2 | Lint | `cd frontend && npm run lint` | clean |
| S2b | Architecture boundaries | `npx eslint src/core src/platform --max-warnings 0` | clean — blocking in CI |
| S2c | Contract typecheck | `cd frontend && npm run typecheck` | exit 0 — blocking in CI |
| S3 | Build succeeds | `cd frontend && npm run build` | exit 0 |
| S4 | **Web bundle unchanged** (for refactors that should not change output) | build before + after, `find dist/assets -type f \| sort \| xargs sha256sum` | identical names + sha256 |
| S4b | *(when S4 cannot apply)* moved-code identity | diff the moved region against `git show <parent>:<file>` after undoing the mechanical edits | byte-identical |
| S5 | Precache manifest | read the PWA line in build output | record the entry count/size it changed to, and why |
| S6 | No unintended tracked-file churn | `git status --short` | only the files intended |
| S7 | Mobile target builds | `cd frontend && VITE_API_URL=… npm run build:mobile` | exit 0, no service worker in `dist-mobile/` |

Test counts and precache size are a **moving baseline**, written down so a
change can say what it moved them to and why. S4 is the decisive one: asset
hashes are deterministic for a given source state (the build version is
stamped into **HTML** and a meta tag, not into JS), so byte-identical
`dist/assets` proves the module graph did not change. Do **not** compare
`dist/*.html`, `public/version.json` or `vercel.json`; those legitimately
change per commit.

### If you edited an inline script in `frontend/index.html`

Run `npx vitest run src/config/__tests__/cspReportOnly.test.js` and paste the
printed hash list into **both** `vercel.json` files
([SECURITY.md](SECURITY.md#inline-scripts-must-be-byte-identical-across-builds)).

## 5. Verifying UI changes

- **Website:** run the dev servers and drive the page in a browser.
- **Android app:** build and install an APK, or use a live-reload APK against
  the local servers; verify motion and colour with screen recordings and the
  CDP/gfxinfo rig ([MOBILE_APP.md](MOBILE_APP.md#5-device-testing)).
- Say what was and was not verified. A passing build or install is not proof
  that a screen works.

## 6. Useful scripts

| Where | Script | Purpose |
|---|---|---|
| `backend/` | `npm run render:templates:dev` / `:prod` | Render Supabase Auth email templates ([INFRASTRUCTURE.md](INFRASTRUCTURE.md#email)) |
| `backend/` | `npm run email:test-all` | Send every email template (to Mailpit locally) |
| `backend/` | `npx ts-node scripts/college-affiliation-report.ts` | Read-only affiliation backfill report |
| `frontend/` | `npm run mobile:*` | Build/sync/open the Capacitor app ([MOBILE_APP.md](MOBILE_APP.md#2-building)) |
| `frontend/` | `npm run robots`, `sitemap`, `og:asset`, `pwa:assets`, `version:stamp` | Generated public assets |
| root | `scripts/await-ci.sh`, `scripts/await-backend.sh` | Deploy gates used by CI and Vercel |

Never run a maintenance script with `--apply` as a test, and remember scripts
run against development by default.
