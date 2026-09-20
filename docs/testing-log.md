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

## Phase 3d.2 — CI enforcement, dead stores, logout purge — **DONE**

### Tested
- S1 ✅ **131/131 files, 1417/1417 tests** (+1 file, +4)
- S2 ✅ lint clean · typecheck ✅ · boundaries ✅ · perf ✅ 3/3 no errors
- S4 n/a (behaviour change), proven by a guard test instead

### CI now enforces the boundaries
Two **blocking** steps added to the `frontend` job, before the existing
non-blocking lint:
- `npx eslint src/core src/platform --max-warnings 0`
- `npm run typecheck`

The full lint stays `continue-on-error` because of an unrelated warning backlog
— which is exactly why the boundary rules needed their own step, or they would
be reported and ignored. Both simulated locally before committing.

### Two dead stores deleted
`postStore.js` and `savedPostsStore.js` held server-derived bookmark ids,
persisted them to `localStorage`, and were **read by nothing**: zero hook
subscriptions outside the store files. Post save-state comes from the post
object via `toggleRegistry`; the Saved page uses its own `['bookmarks']` query.

Worse than dead weight: `hydrateSessionMeta` fired a **`getBookmarks(50)`
request on session restore** to fill one of them.

`savedActivitiesStore` is genuinely used (4 components) and is left alone.

### Correction to what I claimed in 3d
I described these stores as a privacy leak. **That was wrong** — `clearAll()` on
logout does propagate through zustand's persist middleware, so the persisted
copy was already being cleared. The real defect was that they were dead and
costing a network request.

### The actual privacy gap, found while checking that
**The React Query cache was never cleared on sign-out.** `queryClient` was
obtained in `AuthProvider` and used only for `propagateUserMedia`. With
`staleTime: 30s` / `gcTime: 15min`, the next person to sign in on a shared
machine could be rendered the previous person's feed, messages, notifications
and profile from memory until each query refetched.

Fixed in `resetClientStateForNewUser`, which covers both sign-out and
account-switch. **Guard test proven**: with the fix disabled, 3 of its 4 cases
fail; the 4th is the negative case and correctly still passes.

### Bug I introduced and the test caught
First version put `queryClient` in the `useCallback` dep arrays. A test double
returning a fresh object per call turned that into an infinite re-render.
Real `useQueryClient` is stable, but depending on that identity is needless —
now held in a ref with `[]` deps.

### Measured — this phase paid for itself
Entry chunk **534,688 → 533,395 (−1,293)**; precache **−10.63 KiB**.
Cumulative since 3a: **+894 bytes (+0.17%)**, down from +2,187.

---

## Phase 3d — close the open items from 3a–3c — **DONE**

Every leftover recorded below that was a genuine gap rather than a stated
deferral. The transport is now free of client imports and browser globals.

### Tested
- S1 ✅ **130/130 files, 1413/1413 tests** (+2 files, +16)
- S2 ✅ eslint clean · S3 ✅ build · typecheck ✅ exit 0
- Auth/API suites run explicitly: **24 files, 204 tests** — these are the ones
  that exercise the rewired 401/refresh/ETag/session paths
- **perf suite: 3/3 with no unhandled error** (was 3/3 + 1 error)

### Closed
| Was open | Now |
|---|---|
| Transport coupled to Supabase | `platform/web/sessionSource.js` — the subscription, the seed and all three recovery guards in one place |
| Transport coupled to legal-consent + account-status | `TransportHooks.onApiErrorCode`; the transport reports a code, the app decides what it means |
| `platform/web/keyValue.js` not written | `platform/web/storage.js` — sync stores, cookie reader, DOM-event hooks |
| ETag store direct `sessionStorage` | `core/api/etagCache.js` over an injected `SyncKeyValueStore` |
| Async/sync contract mismatch | Resolved in the contract: `SyncKeyValueStore` added, with the reason written down (a bridge call per GET is latency on every screen) |
| Perf mock missing `listQueue` | Fixed; the profile was being taken while a hook threw |

### Verified outcome
`grep` for browser globals in `apiClient.js` code: **none**. All 7 client
imports are used only in the composition-root block at the top of the file. The
one exception is `API_PROXY_PREFIX`, a config constant re-exported for the
socket store — config reading is the composition root's job.

### Behaviour changes, deliberate
- **ETags are now cleared on logout.** They were not before. Stale validators
  belonging to a previous user surviving into the next session on a shared
  device is the same class of problem as T2. Safe direction: the worst case is
  a re-fetch instead of a 304.
- `window.__api_redirecting` removed — written once, read nowhere.

### Bug I introduced and caught mid-phase
Replacing `applyAccountStatusCorrection` with the hook left the legal-consent
block still inline, so `announceLegalConsentChange` would have fired **twice**
per gated 403. Caught by re-grepping for the coupling after the edit.

### Measured
Entry chunk **533,787 → 534,688 (+901)**. Cumulative since 3a: **+2,187 bytes
(+0.41%)**.

### Still open, deliberately
- The transport is decoupled but still **lives in `shared/`**. Making it
  literally portable means splitting this file into `core/api/transport.js`
  (factory) + `shared/api/apiClient.js` (root). Near-mechanical now; it was not
  before.
- Contract tests against a real backend
- Per-namespace endpoint split to restore tree-shaking (worth it for the mobile
  bundle, not for web)

---

## Phase 3c — route policy, media URLs, ApiOrigin seam — **DONE**

Moved `PUBLIC_PATHS`/`BEARER_PATHS`/`SAFE_METHODS` and the media-URL helpers
into `core/`, and put every `window.location` question behind
`platform/web/apiOrigin.js`.

### Tested
- S1 ✅ **128/128 files, 1397/1397 tests** (+2 files, +50)
- S2 ✅ eslint clean  · S3 ✅ build  · typecheck ✅ exit 0
- S4 / S4b ❌ neither applies — `getMediaUrl` was restructured, not moved.
  Verified by behaviour tests instead (50 new assertions).
- Boundary lint ✅ `core/api/paths.js`, `core/api/media.js` clean

### B1 — second instance found and closed
`getMediaUrl` contained the **same** `window.location.hostname` reasoning as
`directBackendUrl`. In a WebView the page hostname is `localhost`, so every
private-origin media URL would have been rewritten to
`capacitor://localhost:4000/…` and every such image would have failed. Now a
platform decision (`ApiOrigin.privateMediaTarget()`), with an explicit
regression test asserting a native client never produces a localhost URL.

### Test fixed, not worked around
`src/config/__tests__/publicPostAccess.test.js` asserted by **slicing the source
text** of `apiClient.js` for `const PUBLIC_PATHS = [`. Moving the list broke it.
Rewritten to call `isPublicPath()` — which is what it actually cared about, and
which would also have caught a rename that kept behaviour correct. Negative
cases added.

### Measured, accepted
Entry chunk **533,183 → 533,787 (+604)**. Cumulative from Phase 3a: **+1,286
bytes (+0.24%)**.

### Left / not covered
- **Transport still coupled to Supabase, legal-consent and account-status
  correction.** Those live in the 401 path and the module-scope auth listener;
  not touched.
- `platform/web/keyValue.js` not written — the ETag store is still direct
  `sessionStorage`. Note the contract mismatch found here: `KeyValueStore` is
  async, but the ETag read is in the synchronous request hot path, so a native
  implementation needs an in-memory cache hydrated at boot rather than a bridge
  call per request.
- No `platform/capacitor/apiOrigin.js` yet — that is Phase 4, and it is now a
  single small file rather than a change to the transport.

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
