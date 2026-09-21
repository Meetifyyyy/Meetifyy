# Testing log — mobile/core programme

Living document. Updated at the end of every phase. Newest phase at the top.

**Rule:** a phase is not done until its exit criteria have evidence. Unverified
means not done.

---

## TO TEST — open items

**On-device run happened 2026-09-21** on a vivo I2208, Android 14 (API 34),
arm64, WebView Chrome 153. Results below are measured, not predicted.

### ✅ Answered on device
| # | Result |
|---|---|
| D1 | The WebView **does** send an Origin: `https://localhost`. It is not null and not absent, so **CORS fully applies**. |
| D2 | **Cause proven, fix built.** Cookies are rejected (`SchemefulSameSiteStrict`); the app now uses session-bound bearer tokens instead. Server side verified end to end against a local backend; on-device login still needs the backend deployed to dev. |
| D4 | **FIXED and re-verified.** Was: one back press from `/login` killed the process. Now `/` → `/login` → back → `/` with the process alive, and back at the root exits cleanly to the launcher with no crash. |
| D7 | Safe areas work: `env(safe-area-inset-*)` supported, `--safe-area-inset-top: 32px`. |
| D8 | Cold start to first frame **1.65 s** (`ActivityTaskManager: Displayed … +1s648ms`). |
| D10 | **PASSES.** 0 service worker registrations, no controller, `caches.keys()` empty. |
| C1 | `npx cap sync` succeeds. |
| C2 | **App launches and runs.** The real website renders — `/login` is the actual site's login screen, not a rebuild. |

### ✅ The cookie blocker (D2) — diagnosed and fixed

Login **succeeds** (`201 /api/auth/login`). The server sets all four cookies.
Chrome then **blocks every one of them**:

```
BLOCKED  mf_access, mf_refresh, mf_sid, mf_csrf
reasons: ["SchemefulSameSiteStrict"]
```

The page origin is `https://localhost`; the API is a different site, so the
request is `sec-fetch-site: cross-site` (measured) and a browser will not store
`SameSite=Strict` cookies from it. `Domain=.meetifyy.app` is **not** a factor —
it domain-matches the API host and is legal here.

**Option A is implemented.** The app holds a session-bound bearer token: the
access token in memory, the refresh token and session id in Keychain/Keystore,
and `x-session-id` on every request. That header is what keeps the token
revocable — see [mobile-auth-decision.md](mobile-auth-decision.md) for why a
bare bearer is refused and always will be.

Verified over real HTTP against a locally-run backend and the dev database:

| Check | Result |
|---|---|
| Login from the native origin returns access + refresh + session id | pass |
| Login from the **web** origin returns none of them | pass (no leak) |
| `Authorization` + `x-session-id` on an ordinary route | **200** |
| Bare bearer, no session id | **401** — the old bypass stays closed |
| Bearer + unknown session id | **401** |
| Refresh from the body rotates the refresh token | pass |
| Refresh from the body with a **web** origin | **401** |
| **Session revoked, then the same token replayed** | **401** — revocation reaches the native client |

**Still to do:** on-device login. The app talks to the deployed dev API, which
does not yet carry this backend change, so the last mile is blocked until
`development` is deployed. Everything else about it is verified.

### ✅ Production CORS — fixed

`allowLocalNetwork` is **forced off in production**, so `https://localhost` was
allowed on dev *only* because that flag defaults on outside production. The
shipped app would have been refused outright, and it would have surfaced for the
first time at release.

`https://localhost` is now in the allow-list by default rather than by an
environment variable someone has to remember — the one exception to "nothing is
baked into the code", and `app.config.ts` says why: it is fixed by
`capacitor.config.json` in this repo, identical in every environment, and owned
by nobody. Allowing the origin does not authenticate it.

Originally measured against dev:

| Origin | Dev result |
|---|---|
| `https://localhost` (Capacitor Android) | allowed |
| `capacitor://localhost` (Capacitor **iOS** default) | **rejected** |
| `http://localhost:5173` (dev web) | allowed |
| `https://evil.example.com` | rejected — the allowlist is not a reflector |

Two consequences:
1. **Production must explicitly allow the app's origin**, or the shipped app
   gets no CORS at all. This only surfaces at release.
2. **iOS will fail CORS today.** Cheapest fix is `"iosScheme": "https"` in
   `capacitor.config.json` so iOS uses `https://localhost` like Android — one
   origin to allowlist instead of two, and no backend change for iOS.

### Still needs a real phone
| # | Test | Why it matters |
|---|---|---|
| D3 | Does the cookie survive 7 days idle on iOS (ITP)? | Moot until D2 is resolved. |
| D5 | iOS swipe-back vs the router's stack | Needs a Mac. |
| D6 | Keyboard + `ChatInputArea` | Partly seen: the keyboard resizes the viewport 801 → 473 CSS px (`adjustResize`), which is the behaviour we want. The composer itself needs a logged-in chat screen — blocked on D2. |
| D9 | Offline launch | Not yet run. |

### Needs a Mac
| # | Test |
|---|---|
| C3 | App launches on iOS (`npm run mobile:ios`) |
| C4 | Deep link opens the right screen |

### Known benign
`Error injecting safe area CSS: TypeError: Cannot read properties of null` —
fires twice at first paint. It is **Capacitor's own** `SystemBars.java` running
its injection script before `document.documentElement` exists. The value lands
correctly afterwards (32px, verified). Upstream, not ours; not worth patching
`node_modules`.

### Noted in passing, not changed
The login form's password input carries `autocomplete="new-password"`. On a
login form that suppresses password-manager autofill. Left alone deliberately:
it is web behaviour, and this programme does not change web behaviour as a
side effect of mobile work.

---

## WHAT IS LEFT — not tested, not built

| Area | State |
|---|---|
| Capacitor packages | ✅ installed (core, cli, android, ios — all 8.5.2) |
| `android/` `ios/` projects | ✅ created, `cap sync` passes |
| Debug APK | ✅ `local/apk/dev/` — `npm run mobile:apk` (debug key, dev API) |
| Release APK | ✅ `local/apk/release/` — `npm run mobile:apk:release` (Meetifyy key, prod API) |
| App icon | ✅ Meetifyy mark, `npm run mobile:icons`; verified inside the installed APK |
| Installed and running on a device | ✅ vivo I2208 / Android 14 |
| **Login on device** | ⚠️ code complete, verified server-side; needs `development` deployed to dev for the on-device run |
| **Production CORS for the app origin** | ✅ allowed by default in `app.config.ts` |
| **iOS CORS origin** | ✅ `iosScheme: https` set, so iOS will use `https://localhost` like Android. Still unverified — needs a Mac. |
| Native back button | ✅ wired via `@capacitor/app` 8.1.1, verified on device. (An earlier entry here claimed a handler was “already written” — that was wrong; only the history-stack model existed.) |
| Push notifications | nothing — no plugin, no `PushToken` table, no sender |
| Secure token storage | ✅ Keychain/Keystore via `@aparajita/capacitor-secure-storage`, 12 tests |
| Route restore after app kill | not built |
| Age gate (18+) | `User.birthday` is optional and unvalidated |
| **Reviewer test account** | **hard blocker** — signup needs a verified college email |
| Privacy labels / Data Safety | not written |
| Crash reporting | `VITE_SENTRY_DSN` exists, nothing reads it |
| Web e2e / native e2e | none |
| Pushed to remote | **no** — all commits local |

---

## How the device tests were run

`adb` + the WebView's own DevTools protocol, which is available because this is
a debug build:

```bash
adb forward tcp:9222 localabstract:webview_devtools_remote_$(adb shell pidof app.meetifyy)
curl -s http://127.0.0.1:9222/json      # lists the page + its websocket URL
```

From there `Network.enable` reports `Set-Cookie` **and Chrome's
`blockedCookies` with reasons**, which is what produced the D2 answer. That is
far more informative than a screenshot, and it is the way to re-check D2 once
the backend changes.

`adb exec-out screencap` returned empty files partway through the session;
`Page.captureScreenshot` over CDP is the reliable alternative.

Two input gotchas, both of which cost a false negative before they were
understood: taps are **screen** coordinates (add the 88px status bar to a
`getBoundingClientRect` value), and the layout **moves when the keyboard
opens**, so a button position must be measured immediately before tapping or
the tap lands on the keyboard and types into the focused field.

---

## Building the dev APK

The toolchain lives **outside the repo**, under `~/.local/android/` (no root, no
system directories touched):

| Piece | Path | Note |
|---|---|---|
| JDK 21 | `~/.local/android/jdk21` | Capacitor 8 compiles at source level 21. JDK 17 fails with `invalid source release: 21`. |
| Android SDK | `~/.local/android/sdk` | cmdline-tools + platform-tools + `android-36` + `build-tools;36.0.0` |

`frontend/android/local.properties` points Gradle at that SDK and is gitignored.
Android Studio is **not** installed — the command-line SDK builds the same APK,
and no IDE is needed for `assembleDebug` + `adb install`.

```bash
export JAVA_HOME=~/.local/android/jdk21
export ANDROID_HOME=~/.local/android/sdk
export PATH="$JAVA_HOME/bin:$PATH"
cd frontend && npm run build:mobile:dev && npx cap sync android
cd android && ./gradlew assembleDebug
cp app/build/outputs/apk/debug/app-debug.apk ../../local/apk/meetifyy-debug.apk
```

**Use `build:mobile:dev`, not `build:mobile`.** `vite build` defaults to
production mode, which loads `.env.production` and would bake the **production**
API origin into a debug APK. `--mode development` loads `.env` only.

Verified in the current APK: `VITE_APP_ENV=development`, the API origin equals
`.env`'s `VITE_API_URL`, no `localhost:4000`, no service worker, no landing page.
Only `VITE_`-prefixed keys are inlined — no server secrets.

Install once the phone is authorised:

```bash
adb install -r local/apk/meetifyy-debug.apk
```

Logs while it runs: `adb logcat | grep -i -E 'chromium|capacitor|meetifyy'`

---

## Standing checks (run on every phase that touches `frontend/`)

| # | Check | Command | Must be |
|---|---|---|---|
| S1 | Unit tests | `cd frontend && npm test` | all green — **currently 133 files / 1440 tests** |
| S2 | Lint | `cd frontend && npm run lint` | clean |
| S2b | Architecture boundaries | `npx eslint src/core src/platform --max-warnings 0` | clean — **blocking in CI** |
| S2c | Contract typecheck | `cd frontend && npm run typecheck` | exit 0 — **blocking in CI** |
| S3 | Build succeeds | `cd frontend && npm run build` | exit 0 |
| S4 | **Web bundle unchanged** | build before + after, `find dist/assets -type f \| sort \| xargs sha256sum` | 153 files, identical names + sha256 |
| S4b | *(when S4 cannot apply)* moved-code identity | diff the moved region against `git show <parent>:<file>` after undoing the mechanical edits | byte-identical |
| S5 | Precache manifest | read the PWA line in build output | 195 entries — **currently 5556.20 KiB** |
| S6 | No unintended tracked-file churn | `git status --short` | only the files the phase intends |
| S7 | Mobile target builds | `cd frontend && VITE_API_URL=… npm run build:mobile` | exit 0, no service worker in `dist-mobile/` |

The counts in S1 and S5 are a **moving baseline**, not a fixed target: they rise
as tests are added and shift as the module graph changes. They are written down
so a phase can say what it changed them to and why, not so they stay still. The
per-phase entries below record each move.

S4 is the real one. Asset hashes are deterministic for a given source state —
the build version is a commit SHA stamped into **HTML**, not into JS — so a
byte-identical `dist/assets` proves the change did not alter the module graph.
Do **not** compare `dist/*.html`, `public/version.json` or `vercel.json`; all
legitimately change per commit.

---

## Phase 6a — Capacitor installed — **DONE**

### Tested
- **C1 ✅ `npx cap sync` succeeds** — first item off the open board
- S1 ✅ 133/133 files, 1440/1440 tests · lint ✅ · boundaries ✅ · typecheck ✅
- Web build ✅ unaffected

### Guards re-checked against the COPIED native assets
`cap sync` copies `dist-mobile/` into each platform. Verified the guards hold
there too, not just in `dist-mobile/`:

| | `android/…/assets/public` | `ios/App/App/public` |
|---|---|---|
| service worker / workbox | ✅ absent | ✅ absent |
| landing page | ✅ absent | ✅ absent |

### Native projects are committed, deliberately
`cap add` can regenerate them, but only pristine. A store release edits them by
hand — permission purpose strings in `Info.plist`, permissions and deep-link
intent filters in `AndroidManifest.xml`, icons, splash, signing config — and all
of that is lost if they are treated as build output.

Ignored instead: Gradle/Xcode build output, `Pods/`, `.gradle/`,
`local.properties`, and each platform's copied `public/` (that is `dist-mobile`
again under another name — committing it would put two copies of the bundle in
every diff and let them drift).

### Caught here
ESLint started linting the generated native projects: **14 errors**. Added
`android/**` and `ios/**` to its ignores. My own echo had said "lint clean"
while errors were printing above it — the echo was unconditional.

### Scripts added
`mobile:sync` runs `build:mobile && cap sync` as one command — running `cap sync`
alone copies whatever happens to be in `dist-mobile/`, which silently ships the
previous bundle to the device.

---

## Phase 5 — wrap the website — **DONE**

**Course correction.** An earlier attempt built a separate mobile app: its own
router, screens, bottom nav, login and data hooks. That duplicated a website
which already exists and is already responsive. Those commits were reverted and
are not in this branch.

The native build now mounts the real app — same `App`, same providers, same
routes, same screens.

### What actually differs between the two builds

| | Why it has to |
|---|---|
| Opening screen replaces `/` | The website's `/` is a landing page: marketing for someone who has not heard of Meetifyy. Someone opening the installed app has, and has installed it. One route, passed as a prop. |
| No service worker | A caching worker in a WebView can serve its copy of the *deployed site* instead of the reviewed bundle; iOS has no SW support at all. Absent from the config, not skipped at runtime. |
| No version gate | A bundled app has no deployment to be stale against. |
| No Vercel analytics | Reports to a web project; already host-gated there. |
| Native API origin | The web one derives the host from `window.location`, which reads `localhost` in a WebView. |

### Tested
- S1 ✅ **133/133 files, 1440/1440 tests**
- S2 ✅ lint · boundaries ✅ · typecheck ✅ · both builds ✅
- Loaded at 375×812: launch shell lifts, **0 service workers**, opening screen
  renders, and **"Sign in" reaches the website's own login screen** — its
  gradient, wordmark, "Welcome back", password eye. Nothing rebuilt.

### The bug this phase produced, and the trap behind it
The first version gated the API origin on `config.isMobileClient` — a property
on a runtime object. Rollup cannot fold that, so **the native origin shipped in
the web bundle and the 40 kB marketing landing page shipped in the app**.
Neither breaks anything at runtime, which is what makes it survive.

`config/index.js` already documents this exact trap for `IS_DEV_BUILD`:
> use this constant for anything that gates a lazy import or a whole dev-only block

Fixed by adding `IS_MOBILE_BUILD` beside it as a direct `import.meta.env`
comparison, which Vite replaces with a literal. Both bundles verified clean.

### Two new CI guards, both proven to fire
- `dist-mobile/` must **not** contain `LandingPage-*.js`
- `dist/` **must** contain it

The failure is silent in both directions: the app carries a page it can never
route to, the website loses its front door.

### Also fixed
`index.mobile.html` had the launch shell but not the script that lifts it, so
the app booted and then sat behind its own logo forever. `AuthContext` calls
`window.__meetifyyBoot.ready()` with optional chaining, so nothing threw.

Ten `@config` test mocks needed the new export — vitest fails the import
outright when a mock omits a named export, which is how they surfaced.

### Left
- `cap init` / `cap add android ios` — needs the device toolchain
- The on-device spike: cookies vs bearer, back button, deep links, safe areas
- `@capacitor/app`, push, secure storage — Phase 6

---

## Phase 4a recheck — **DONE**

Everything from this session re-verified from a clean state rather than trusted.

### Rebuilt from scratch
Both outputs wiped and rebuilt. Web: 153 assets, **byte-identical** to the
pre-Phase-4 baseline. Mobile: builds, and every asset its `index.html`
references exists.

### The mobile bundle was actually loaded, not just built
Served via the new `npm run preview:mobile` and opened in a browser:

| Check | Result |
|---|---|
| Renders | ✅ React mounted, launch shell removed |
| Console errors | ✅ none |
| Service-worker registrations | ✅ **0**, though the browser supports them |
| Cache Storage entries | ✅ **0** |
| API origin shown | ✅ `https://api.invalid` — the configured value |

The last row is the important one: the preview is served from
**`http://localhost:4174`**, the same condition that breaks the web `ApiOrigin`
inside a WebView, and the API origin was unaffected. B1 disproven at runtime,
not only in a unit test.

### Web dev server
Started and loaded: real app renders, correct title, no console errors. This was
the one path a `vite build` would not have exercised after the config refactor.

### Alias extraction proven lossless
The pre-refactor alias map and what `sharedAliases()` produces were compared
programmatically: **10 vs 10, identical**.

### Mobile bundle excludes every web-only heavyweight
framer-motion, emoji-mart, hugeicons, heroicons, socket.io, react-router,
html2canvas, workbox — **all absent**. 1.78 MB total.

### CI validated by execution, not by reading
YAML parses; every multi-line `run:` block passes `bash -n`; the mobile job's
steps were then run verbatim and all passed.

### Independence experiment (from the D5 exit criteria)
Deleted `src/mobile/`, `src/platform/capacitor/`, `index.mobile.html` and
`vite.mobile.config.js`, then built and tested the web app:
**build succeeded, 132 files / 1431 tests passed.** That is exactly 1 file and
9 tests fewer — the deleted Capacitor test and nothing else. Restored after.

### Architecture rules re-swept
`core/` portability violations: **0**. `@capacitor` imports outside
`platform/capacitor/`: **0**. Mobile root importing the web root: **0**. Web
importing mobile: **0**. Singletons in `core/`: **0**.

### Two mistakes found by the recheck itself
1. **My own audit script produced a false positive** — it reported `window` in
   `transport.js` because its comment-stripping regex only handled comments at
   line start, missing a trailing `// ... a far longer window`. ESLint was right
   and the script was wrong. Fixed before trusting the result.
2. **`base` was discussed in the mobile config's comments but never set.** It
   was already `/` by Vite's default, but a default is not a decision and a
   reader looking for it found nothing. Now explicit.

---

## Phase 4a — two build targets — **DONE**

A second client now builds from `core/` over `platform/capacitor/`, with its own
runtime and its own entry. Native projects (`cap add`) are **not** here — that
belongs with the on-device spike.

### Tested
- S1 ✅ **133/133 files, 1440/1440 tests** (+1 file, +9)
- S2 ✅ lint · boundaries ✅ · typecheck ✅
- **S4 ✅ web `dist/assets` byte-identical — 153 files**, before and after
- `npm run build:mobile` ✅

### The payoff, measured
`dist-mobile` is **1.82 MB** against the web bundle's 4.6 MB, because it pulls
in none of the landing page, framer-motion, emoji or icon sets — and because
`dropWebOnlyPublicAssets` removes the 15 iOS PWA splash screens (**1.14 MB**),
`robots.txt`, `version.json` and the OG image, which `publicDir` had copied in
wholesale.

### B4 closed structurally
`vite.mobile.config.js` never loads vite-plugin-pwa, so there is no worker to
register. CI proves the absence: no `sw.js`, no `workbox`, no
`serviceWorker.register` in `dist-mobile/`. **Guards proven to fire** by
planting a fake `sw.js` and a fake localhost string and watching each trip.

### B1 closed, and guarded by a test rather than a grep
`platform/capacitor/apiOrigin.js` returns the configured origin and probes
nothing. 9 tests install a **real WebView-shaped `window`** (`https://localhost`
and `capacitor://localhost`) with `preferLocalBackend: true` — the exact
conditions that break the web implementation — and assert the answer is
unaffected.

### Three of my own mistakes, caught here
1. **My plan said `base: './'` for mobile. Wrong.** Relative asset paths break a
   client-side router: from `/messages/abc`, `./assets/x.js` resolves to
   `/messages/assets/x.js`. Capacitor serves `webDir` at the origin root, so `/`
   is correct.
2. **My plan said "path-filtered CI". The repo already refuses that, for a good
   reason** documented in `ci.yml`: a skipped required check reports as
   *pending*, not passed, so a path filter would deadlock every PR that misses
   those paths. Not added. The `mobile` job is wired into `validate`'s `needs`
   instead, as that header instructs.
3. **My first CI localhost guard failed on the real bundle** — it matched
   `http://localhost:9999`, a default constant inside `@supabase/auth-js`. A
   guard that fires on a vendor string gets disabled, so it was replaced with
   the unit test above. My own mobile shell also tripped the SW grep by merely
   naming `serviceWorker`; that diagnostic is gone and the patterns are narrow.

### Left for Phase 4b / 5
- `cap init` + `cap add android ios` — needs the device toolchain; yours
- `platform/capacitor/` storage re-exports the web implementations, which is
  correct today (a WebView has DOM storage) and becomes `@capacitor/preferences`
  in Phase 6
- Mobile session source still the web one — the spike decides cookie vs bearer
- No mobile UI yet (Phase 5); `src/mobile/main.jsx` renders a placeholder shell

---

## Phase 3e — transport into core/ — **DONE**

`shared/api/apiClient.js` is now **155 lines of assembly**, down from 1,639 at
the start of Phase 3. The transport is `core/api/transport.js`, a factory.

### Tested
- S1 ✅ **132/132 files, 1431/1431 tests** (+1 file, +14)
- S2 ✅ lint · boundaries ✅ · typecheck ✅ · build ✅
- S4/S4b n/a — a factory wrapper is not a byte-identical move

### The proof
- **Boundary lint passes on `core/api/transport.js`.** It is subject to the same
  rules as every other core module: no DOM, no `import.meta.env`, no React, no
  router, no imports back into client code.
- `grep` for browser globals in the transport finds **9 matches, all in
  comments**; zero real references. Client imports: **0**.
- The 14 new tests run in the default `node` environment — **no `window`, no
  `document`, no `localStorage`**. A transport that still depended on one could
  not construct, so the environment is half the assertion.

### What the tests pin
Not the request path (the app's own suites cover the 401 retry, conditional
requests and failover against the real thing) but the property nothing else
checks: **two transports are independent**. Separate origins, separate CSRF
tokens, separate failover flags, separate store purges. If those ever share,
web and mobile would be one client wearing two names.

### `no-undef` earned its place
The extraction dropped the `core/api/paths` import. Four `no-undef` errors —
`SAFE_METHODS`, `isBearerPath`, `isPublicPath` — caught it before any test ran.
That is the rule the lint config says it exists for, doing exactly that job.

### Measured
Entry chunk **533,395 → 533,973 (+578)**, the factory-wrapper cost again.
Cumulative since 3a: **+1,472 bytes (+0.28%)**.

### Left
- Contract tests vs a live backend (needs a running backend)
- Per-namespace endpoint split (pays off in the mobile bundle, not on web)
- `dependency-cruiser` (wants a real zone matrix, i.e. `src/mobile/`)
- Full TS in `core/` (Phase 10, RN prerequisite)
- `platform/capacitor/*` — Phase 4. Each is now one small sibling file.

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
