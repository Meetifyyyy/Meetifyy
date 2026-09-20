# Testing log — mobile/core programme

Living document. Updated at the end of every phase. Newest phase at the top.

**Rule:** a phase is not done until its exit criteria have evidence. Unverified
means not done.

---

## Standing checks (run on every phase that touches `frontend/`)

| # | Check | Command | Must be |
|---|---|---|---|
| S1 | Unit tests | `cd frontend && npm test` | 124/124 files, 1296/1296 tests |
| S2 | Lint | `cd frontend && npm run lint` | clean |
| S3 | Build succeeds | `cd frontend && npm run build` | exit 0 |
| S4 | **Web bundle unchanged** | build before + after, `find dist/assets -type f \| sort \| xargs sha256sum` | 153 files, identical names + sha256 |
| S4b | *(when S4 cannot apply)* moved-code identity | diff the moved region against `git show <parent>:<file>` after undoing the mechanical edits | byte-identical |
| S5 | Precache manifest unchanged | read the PWA line in build output | 195 entries, 5564.13 KiB |
| S6 | No unintended tracked-file churn | `git status --short` | only the files the phase intends |

S4 is the real one. Asset hashes are deterministic for a given source state —
the build version is a commit SHA stamped into **HTML**, not into JS — so a
byte-identical `dist/assets` proves the change did not alter the module graph.
Do **not** compare `dist/*.html`, `public/version.json` or `vercel.json`; all
legitimately change per commit.

---

## Phase 3b — apiClient split — **DONE**

The 20 endpoint namespaces moved out of `shared/api/apiClient.js` into
`core/api/endpoints.js` as a factory over an injected transport. The transport
stays where it is: it is the half that reaches into Supabase, the config object,
the legal-consent bus and account-status correction.

**S4 does not apply to this phase and that is not a pass.** Splitting a module
changes the module graph, so 81 of 153 chunk hashes changed. S4b was used
instead.

### Tested
- S1 ✅ **126/126 files, 1347/1347 tests** (+1 file, +8)
- S2 ✅ eslint clean
- S3 ✅ build exit 0
- **S4b ✅ endpoint bodies BYTE-IDENTICAL** — 652 lines, verified by undoing the
  two mechanical edits (drop `export `, indent 2) and diffing against
  `git show phase3/core-extraction:…/apiClient.js`
- Public surface ✅ **20 namespaces / 191 methods, identical**
- S5 ⚠️ 195 entries, **5564.80 KiB (was 5564.13, +0.67)**
- S6 ✅ only intended files
- Boundary lint ✅ `core/api/endpoints.js` clean — proof the endpoints were
  genuinely portable
- typecheck ✅ exit 0

### Measured regression, accepted
Entry chunk **532,501 → 533,183 bytes (+682, +0.13%)**. The 20 namespaces were
individually tree-shakeable module bindings; they now return together from one
factory, so none can be shaken alone. Recoverable by splitting
`endpoints.js` into one file per namespace — worth doing when the **mobile**
bundle needs it (it will construct only what it uses), not for 682 bytes on web.

### Left / not covered
- Transport still in the legacy zone, still coupled to Supabase / `@config` /
  legal-consent / account-status. Inverting those is what a second client needs
  and is **not** done.
- `platform/web/` adapters (`keyValue`, `csrfCookie`, `apiOrigin`) not written
- No contract tests against the real backend yet
- 107 importers unchanged by design — they still import from
  `@shared/api/apiClient`, which re-exports all 20

---

## Phase 3a — scaffolding, contracts, boundary lint — **DONE**

Scope note: the ~19 pure domain/validation/constant files were **not** moved.
Nothing consumes them from `core/` yet, and the instruction is to extract only
what the apiClient split and the first mobile screens actually need. They move
in 3b and 5, pulled by a real consumer.

### Tested
- S1 ✅ **125/125 files, 1339/1339 tests** (was 124/1296; +1 file, +43 tests)
- S2 ✅ eslint clean
- S3 ✅ build exit 0
- S4 ✅ **153/153 assets identical to the Phase 2 build** — new modules are
  unreferenced, so the web bundle is provably untouched
- S5 ✅ 195 entries / 5564.13 KiB
- S6 ✅ only intended files
- `npm run typecheck` ✅ exit 0 (`strict`, `noUncheckedIndexedAccess`)

### Boundary lint — proved by deliberate violation, not by assumption
A throwaway probe file in `src/core/` importing and touching each forbidden
thing produced **10 errors from 10 violations**, then was deleted:

| Violation | Rule |
|---|---|
| `@config`, `@shared/*`, `../shared/*` imports | `no-restricted-imports` |
| `@capacitor/preferences` | `no-restricted-imports` |
| `react` | `no-restricted-imports` |
| `window`, `document`, `localStorage`, `navigator` | `no-restricted-globals` |
| `import.meta.env` | `no-restricted-syntax` |

Capacitor rule scope also proved both ways: **errors** from `src/features/`,
**clean** from `src/platform/capacitor/`.

R1 = 0, R2 = 0, R4 = 0, R11 = 0 violations in real code.

### Caught during this phase
- `noUncheckedIndexedAccess` found a real unchecked-index bug in
  `parseIntentFromPath` (`split('?')[0]` chaining). Fixed. This is the concrete
  argument for these two files being typed.
- ESLint flat-config precedence bug in my own first draft: a later block with
  the same rule key replaces an earlier one, so the general Capacitor block was
  silently overriding `core/`'s stricter `no-restricted-imports`. Reordered so
  the specific block comes last.

### Left / not covered
- Boundary lint not in CI yet (Phase 4 adds path-filtered CI)
- `**/*.ts` is excluded from ESLint — `npm run typecheck` covers those two files
  instead of adding typescript-eslint for them
- No `dependency-cruiser` graph yet — worth it when `src/mobile/` exists
- `core/` is JS apart from the 2 contract files; full TS is Phase 10

---

## Phase 2 — remove dead resolve aliases — **DONE** (`849c86b`)

### Tested
- S1 ✅ 124/124 files, 1296/1296 tests
- S2 ✅ eslint clean
- S3 ✅
- S4 ✅ **153/153 asset files identical name + sha256**, before vs after
- S5 ✅ 195 entries / 5564.13 KiB both builds
- S6 ✅ only `vite.config.js` + `vitest.perf.config.js`

### Left
Nothing. Configuration-only; no source file changed.

### Known pre-existing, NOT introduced here
`src/__perf__/instantmatch.perf.jsx` logs an unhandled
`default.listQueue is not a function` — incomplete `matchSocketClient` mock.
Confirmed identical on unmodified `development`. Perf tests still pass 3/3.

---

## Phase 1 — Capacitor spike

### Part 1A — dev CORS matrix — **DONE** (2026-09-20, no config change, no credentials)

| Probe | Result |
|---|---|
| dev API reachable, no Access gate | ✅ `GET /health` → 200 |
| `capacitor://localhost` | ❌ refused — preflight 404, no `ACAO` |
| `https://localhost` | ⚠️ allowed **in dev only**; `allowLocalNetwork` is forced false in production |
| `http://localhost:3000` | ⚠️ allowed in dev only |
| `https://evil.example.com`, `null` | ✅ refused |
| **no `Origin` header** | ✅ **allowed**, incl. non-simple POST with `Authorization` |
| bearer on an ordinary route | 401 `"Session has been signed out"` |
| bearer on an `@AllowBearerToken` route | 401 `"Invalid or expired authentication token"` |

Two oracles this gave us, both credential-free:
1. A **refused preflight is a 404**, not a header-less 204.
2. The two 401 messages distinguish the guard's bearer gate from token
   validation — so the decisive bearer test needs **no dev account**.

### Part 1B — needs a dev test account — **NOT RUN**
Only cookie-attribute inspection and socket-with-real-token remain; the
on-device spike covers both.

### Part 2 — on-device — **NOT RUN** (owner-executed)
Runbook: [spike-capacitor-runbook.md](spike-capacitor-runbook.md), tests 1–14.
**Test 1 is the highest-value measurement in the programme**: what `Origin`
header, if any, the WebView sends. If none, native needs no CORS change in any
environment.

### Verified during runbook authoring
- Staging script refuses a production `dist/` and stages nothing on refusal
- `dist/index.html` is the prerendered homepage; `dist/app.html` is the SPA shell
- `--viewport-fit` patches the staged copy only

---

## Assumptions still unmeasured

Each is resolved by a Part 2 test and retagged when it is.

| # | Assumption | Resolved by |
|---|---|---|
| A1 | `capacitor://` is not a secure-context scheme for cookies | Test 2 |
| A2 | `SameSite=None; Secure` works from Android `https://localhost` | Test 2 |
| A3 | WebKit ITP blocks the API cookie regardless of `SameSite` | Test 3 |
| A4 | WKWebView back/forward gesture defaults | Test 6 |
| A5 | `@capacitor/keyboard` resize modes vs `ChatInputArea` | Test 8 |
| A6 | Android WebView registers SWs at `https://localhost` | Test 13 (moot — excluded at build time) |
| A7 | `navigator.clipboard` availability under `capacitor://` | deferred with Clipboard |
| A8 | Android Keystore invalidation after biometric/PIN change makes stored tokens unreadable | Phase 5 — must degrade to an ordinary sign-out, never a crash |

---

## Test gaps in the codebase (not scheduled)

| Gap | Note |
|---|---|
| No browser e2e | Playwright proposed for Phase 9 |
| No native e2e | Manual scripted checklist first |
| No contract tests vs the backend | Proposed Phase 3b, once `core/api/endpoints` exists |
| ESLint non-blocking in CI | `continue-on-error: true` for backend and frontend jobs |
| Backend: 155 spec files, 2 e2e | not touched by this programme |
