# Engineering log

Dated, chronological evidence: what was measured, built, broken and fixed, and
what was left open at the time. **Treat every entry as evidence from its date,
not as live state.** Open-item tables below were true when written; current
status lives in the topical documents:
[MOBILE_APP.md](MOBILE_APP.md), [SECURITY.md](SECURITY.md#11-open-security-items),
[BACKEND_AND_API.md](BACKEND_AND_API.md#not-implemented-yet),
[DECISIONS_AND_GUIDELINES.md](DECISIONS_AND_GUIDELINES.md#open-decisions-owner).

Contents:

1. [Mobile/core programme and device testing](#mobilecore-programme-and-device-testing)
   — the Capacitor programme phases, on-device runs, root-cause write-ups
   (formerly `docs/testing-log.md`). Sections cited elsewhere:
   [System bars](#system-bars-page-transitions-profile-loading-reply-bar-2026-09-29),
   [Live local APK installation mistakes](#live-local-apk-installation-mistakes-2026-09-27).
2. [Mobile auth: the options, at diff level — 2026-09-21](#mobile-auth-the-options-at-diff-level--2026-09-21)
   (formerly `docs/mobile-auth-decision.md`; the design record behind
   [SECURITY.md §3](SECURITY.md#3-the-installed-app-session-bound-bearer-tokens)).
3. [Security audit and remediation — 2026-09-09](#security-audit-and-remediation--2026-09-09)
   (formerly `SECURITY-AUDIT.md`).
4. [Android performance audit — 2026-10-05](#android-performance-audit--2026-10-05)
   (formerly `PERFORMANCE_AUDIT.md`).
5. [Android performance work — 2026-10-05](#android-performance-work--2026-10-05)
   (formerly `PERFORMANCE_OPTIMIZATION.md`).

Add new entries to the relevant part, newest first within the mobile part,
and move any durable rule or current fact into the topical document as well.

---

## Mobile/core programme and device testing

Living document. Updated at the end of every phase. Newest phase at the top.

**Rule:** a phase is not done until its exit criteria have evidence. Unverified
means not done.

---

### TO TEST — open items

**On-device run happened 2026-09-21** on a vivo I2208, Android 14 (API 34),
arm64, WebView Chrome 153. Results below are measured, not predicted.

#### ✅ Answered on device
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

#### ✅ The cookie blocker (D2) — diagnosed and fixed

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
revocable — see [SECURITY.md](SECURITY.md#3-the-installed-app-session-bound-bearer-tokens) for why a
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

#### ✅ Production CORS — fixed

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

#### Still needs a real phone
| # | Test | Why it matters |
|---|---|---|
| D3 | Does the cookie survive 7 days idle on iOS (ITP)? | Moot until D2 is resolved. |
| D5 | iOS swipe-back vs the router's stack | Needs a Mac. |
| D6 | Keyboard + `ChatInputArea` | Partly seen: the keyboard resizes the viewport 801 → 473 CSS px (`adjustResize`), which is the behaviour we want. The composer itself needs a logged-in chat screen — blocked on D2. |
| D9 | Offline launch | Not yet run. |

#### Needs a Mac
| # | Test |
|---|---|
| C3 | App launches on iOS (`npm run mobile:ios`) |
| C4 | Deep link opens the right screen |

#### Known benign
`Error injecting safe area CSS: TypeError: Cannot read properties of null` —
fires twice at first paint. It is **Capacitor's own** `SystemBars.java` running
its injection script before `document.documentElement` exists. The value lands
correctly afterwards (32px, verified). Upstream, not ours; not worth patching
`node_modules`.

#### Noted in passing, not changed
The login form's password input carries `autocomplete="new-password"`. On a
login form that suppresses password-manager autofill. Left alone deliberately:
it is web behaviour, and this programme does not change web behaviour as a
side effect of mobile work.

---

#### Open since 2026-09-23
| # | What | How |
|---|---|---|
| S1 | Full signup on the APK against dev after `3f58667a`: OTP → avatar → Create Account must land on `/home` and survive an app restart. | Device run; watch `adb logcat` and the dev API log for `session/adopt` 200. |

### WHAT IS LEFT — not tested, not built

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

### How the device tests were run

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

### Sentry audit, dev-site errors and dev/production isolation — 2026-10-27

Sentry connector access: the `meetifyy-dev` org only. The production org
(`meetifyy`) is not connected, so no production issue was inspected.

**Root causes fixed (code, uncommitted)**

| Sentry issue | Cause | Fix |
|---|---|---|
| API-C, API-G (`reading 'count'`, `expired is not iterable`) | Prisma closed in `onModuleDestroy`, BullMQ workers in `onApplicationShutdown`: jobs ran against a closed DB on every restart | `DrainingWorkerHost` closes workers in `beforeApplicationShutdown`; Prisma disconnects in `onApplicationShutdown`; `DatabaseUnavailableError` instead of `undefined` |
| API-D/E/F and 3 of API-6's events (Supavisor `08006` "Failed to connect to database: econnrefused"), API-B (`Connection terminated unexpectedly`) | Pooler refusals and drops not recognised as transient | `connection-retry.middleware.ts`: two retries for P1001/P1002/P1008/P1017 and those messages. The other 432 API-6 events are "table `MatchQueueEntry` does not exist" from the 2026-10-13 dev database rebuild, not a code fault |
| API-2 (Slow DB Query, `SELECT 1`) | Warm-up and 25 s keep-alive ran outside requests, each a root `prisma:client:operation` transaction | `pingPool` under `suppressTracing` |
| ANDROID-8 (`setPointerCapture`: no active pointer) | Pointer already released when capture was requested | capture guarded in `openScreenMotion.js` |
| ANDROID-9 (`(rawCampusUsers \|\| []).forEach is not a function`) | Non-array cache value passed the `\|\| []` guard | `asList` in `useUsersMap.jsx` |
| Dev console: 83× `net::ERR_BLOCKED_BY_CLIENT` on Sentry envelopes | Ad blocker on `*.ingest.sentry.io` | same-origin tunnel `/api/app-events` + host rewrites |
| Dev console: CSP `connect-src` violation, CORS failure, `ERR_FAILED` on the Access login URL | `/version.json` fetch followed Cloudflare Access's redirect | `redirect: 'manual'`; on `opaqueredirect`, reload once per tab session |
| Noise: local runs, live-reload builds | No gate on either | `SENTRY_REPORT_LOCAL`, `VITE_SENTRY_REPORT_DEV_SERVER` (both default off) |
| Isolation: admin cookies | `admin_*` names identical in both environments on `.meetifyy.app` | `mf_dev_admin_*` in development; production names unchanged |

**Verified**
- Keep-alive suppression: a scratch script with the real SDK and Prisma
  client (closed port, so no database) recorded 4 root transactions for two
  unsuppressed pings and 0 for the same pings under `suppressTracing`.
- Tunnel contract: an envelope carrying the DSN only in its header, posted to
  the dev web project's envelope URL, returned 200 and arrived as
  MEETIFYY-WEB-2. The Vercel rewrite itself is untested until deployed.
- Live CORS: each API refuses the other environment's origin (preflight).
- MEETIFYY-WEB-1 (stale chunk) lines up with two deploys six minutes apart;
  the second event carries the newer release, so the recovery reload worked.

**Not verified (needs a deploy or access)**: the rewrite on Vercel, the
version-gate reload behind an expired Access session, admin sign-in with the
new cookie names, production Sentry (org not connected), any production
behaviour.

---

### Startup, splash, push icon and page transitions — 2026-10-26

Device: iQOO I2208, Android 14, WebView 155, 1080×2408 @ 440 dpi, debug APK
(`app.meetifyy.dev`, signed in, saved feed on the device). Debug builds run
without AOT compilation, so native start is slower than a Play release.

**How it was measured.** `am start -W` for TTID (`Displayed`), the
`Fully drawn` line for TTFD (`reportFullyDrawn`, sent when the first screen
shows its content AND the splash has begun to uncover it), the debug-only
`MeetifyyLaunch` log (times since process start), CDP `performance` marks
(`meetifyy:auth-decided`, `:surface`, `:splash-release:*`, `:fully-drawn`),
`atrace` for native slices, `screenrecord` + per-frame pixel sampling for
flicker, and `gfxinfo framestats` for transitions. The phone's speed drifts
by 10–30% over a long session (heat), so before/after pairs were run
**interleaved**, reinstalling the old and new APKs alternately.

**Root causes found**

| Symptom | Cause (evidence) |
|---|---|
| Splash "flickers" before Home | the exit hid the logo at once and faded the background before the WebView had drawn the page in the window: logo → 2–3 blank frames → feed all at once (screenrecord) |
| Splash slow to leave | the system handed the held splash to the app ~270 ms after the activity's first frame (`starting_reveal` in atrace), all of it after the page was ready: 340–490 ms from "ready" to reveal |
| Auth decided late | Sentry's native init (~360 ms traced) ran first on Capacitor's single plugin thread; the Keystore reads queued behind it |
| JS compiled every launch | no V8 code cache for intercepted responses: `Code Cache/js` held only ~210-byte markers after a dozen launches |
| Settings flicker from Profile | the menu closed on tap while the native screenshot was being taken: menu gone (frame 20), back in the picture (frame 21), slid away |
| Chat jumps after opening | history not in memory: skeleton slid in, messages arrived ~0.9 s after the slide |
| Settings sub-pages | swapped in place with no motion (plain `navigate`), unlike Settings, chats and profiles |

**Results** (cold = force-stopped; times from `am start` unless noted)

| Metric | Before | After | Notes |
|---|---|---|---|
| TTID (`Displayed`) | 2.53–3.50 s, median ≈2.55 s | 1.10–1.43 s | not comparable: after, it is the native window with the splash handed over; the page is not visible yet |
| Home visible (TTFD) | ≈ TTID + 0.35–0.45 s hand-over (≈2.9–3.0 s), not reported | 2.50–2.89 s, median ≈2.56 s | same session as the "before" baseline |
| Home visible, interleaved A/B, screenrecorded (4 pairs) | median 3.77 s | median 3.47 s | absolute values inflated by recording |
| Page ready (page clock), interleaved (6 each) | median 1.97 s | median 1.68 s | |
| Auth decided (page clock), cool phone | ≈1.23 s | ≈1.06 s | Sentry off the plugin thread |
| Warm start (activity recreated) | TTID 0.92–0.98 s | TTID 0.25–0.27 s, TTFD 0.89–0.93 s | under 1 s to a usable Home |
| Hot start | 0.09–0.11 s | 0.13–0.17 s | no splash; noise |
| Entry chunk (production build) | 759.7 KB raw / 243 KB gzip | 590.5 KB / 186 KB | Sentry now a 169 KB lazy chunk |
| Blank frames at splash exit | 2–3 | 0 | light and dark |
| Profile → Settings menu flicker | menu vanishes and returns | none | |
| Chat first open after launch | skeleton, messages +0.9 s | messages during the slide | top 3 histories prefetched at idle |

**The 1-second target.** Met for warm starts (Home fully drawn in ~0.9 s).
Not met for cold starts: ~1.05 s passes before the page's first byte
(process, `bindApplication` with debug dex verification, Firebase/Sentry
providers, WebView/Chromium init ~350 ms on the UI thread), and the page then
needs ~1.3–1.5 s to parse ~1.2 MB of JS/CSS without a code cache, restore the
session and render Home.

**Tried and rejected, with numbers**

- V8 explicit compile hints (`//# allFunctionsCalledOnLoad` on the entry and
  vendor-react): DOMContentLoaded ~95 ms later, boot after it ~120 ms faster,
  TTID unchanged (2.55 vs 2.53 s medians). Removed.
- No exit listener (the system's own splash exit): no hand-over wait, but on
  this device it showed ~130 ms of a near-blank window before the feed.
- `WebViewCompat.startUpWebView`: needs androidx.webkit 1.16 (we have 1.14);
  the WebView is inflated ~90 ms into `onCreate`, leaving little to overlap,
  and starting it from `Application.onCreate` would also load Chromium in
  push-only background processes. Not adopted.

**Transitions (gfxinfo framestats, this device, 60 Hz).** Open slides: 1–3
missed frames of ~26, RenderThread "issue" median 4–6 ms. Closing onto a live
Profile: RenderThread time is bimodal (median ~6 ms or ~15 ms on the same
build, with or without Profile's cover layers), so it is GPU clock state, not
page content; 1–3 missed frames per close. Tap → motion: ~140–150 ms (capture
45–60 ms, navigate + commit ~15 ms, two settle frames ~35 ms, paint wait
~35 ms). Lower-end devices were not available to test.

**Push icon.** Rendered on this phone's status bar and shade with
`cmd notification post` (shell-posted, so labelled "Shell"). An end-to-end
FCM push to DEV APP was not possible: the app's notification permission is
not granted on this phone.

---

### Signup on the APK returns to the opening screen — 2026-09-23 (root cause)

**Symptom.** On the last signup step, Create Account sent the user back to the
opening screen. Not a crash and not a WebView reload.

**Evidence** (dev API logs and Supabase auth logs, 12:34–12:37 UTC):
`/verify` 200, then the handover `PATCH /api/users/me` 401 and
`POST /api/auth/session/adopt` 401 "Missing authorization header", then
Create Account's `PATCH /api/users/me` 401 → refresh 401. The auth user existed
with no `User` row; every later login was a 500 on `UserSession_userId_fkey`.

**Cause.** The handover calls took their bearer from the session source. The
web source picks up the `verifyOtp` session through its provider subscription;
`platform/capacitor/sessionSource.js` only holds tokens it is handed, so on the
app both calls carried no credential. The failure was logged and the user marked
signed in anyway, so the next authenticated request found nothing to refresh
and cleared the session, and the route gate sent them to `/`.

**Fix** (`51816ac`, `b0755c2`): the handover passes the verified session's
token explicitly (`bearer` option on the transport; a 401 on such a call does
not touch the ambient session), a failed handover no longer signs the user in,
and login and adoption create the profile before the session row.

**Also found:** Step 4 verified each OTP twice (Supabase logged 200 then 403
`otp_expired`) and flashed a one-frame success state. Fixed in the same commit.

**Verified:** 7 regression tests fail on the old code and pass on the new one.
Backend and frontend suites green; deployed to dev as `3f58667a`.
**Not verified:** a signup on a device — see the open item above.

### White system bars, and themed launcher icons — 2026-09-21

**Symptom:** a dark app with a **white status bar and white navigation bar**.

**Cause.** The WebView is inset by the safe areas, so the strips above and below
it show the WINDOW background, not the page. That background came from
`@color/launchBackground`, whose `values-night` variant only answers "what is
the PHONE set to". The app has its own theme toggle — the report came from an
app-dark / phone-light device, where the qualifier never applied.

**Fix.** The colour is pushed from the web layer, which is the only thing that
knows the app's theme. It is read from `--color-bg-white`, the same variable the
app's header and bottom navigation use, so the system bars match the app's own
bars by construction rather than by two values being kept in step by hand.

Capacitor 8's built-in `SystemBars` can only set icon STYLE — it has no
background API, because Android 15 expects apps to draw behind the bars. So a
small native plugin (`SystemUiPlugin.java`, ~70 lines, no dependency) sets the
status bar, navigation bar and window colours. `SystemBars.setStyle` is still
called for iOS, which has no `SystemUi`.

Applied on a `MutationObserver` over `data-theme` rather than by hooking
`ThemeContext`, which is shared with the website and has no system bars to
colour. On the next frame, not the same tick: `data-theme` is set before styles
recalculate, so reading the variable immediately returns the outgoing colour and
the bars end up one change behind.

**Launcher icon.** An adaptive icon cannot be transparent — Android requires a
background layer. Now `#FFFFFF` light and `#202020` night, so it stops being a
white tile on a dark home screen. Verified in the APK: `() #ffffffff`,
`(night) #ff202020`. The `monochrome` layer added earlier takes precedence on
launchers that support themed icons.

14 tests on the colour helpers, including that luminance is weighted — a channel
average calls the brand blue "light" and the bar icons come out invisible.
1508 passing, web bundle carries none of it.

**❌ Not verified on device.** Needs: bars correct in app-dark/phone-light and
the reverse, on an in-session theme toggle, and after background → foreground.

---

### Cold-start sign-out — 2026-09-21 (root cause)

**Symptom:** sign in, close the app, reopen → asked to sign in again. Working
normally within a session.

**Cause — one line, in the 401 retry.** The retry rebuilt the `Authorization`
header only `if (retryHeaders['Authorization'])`, i.e. only when the ORIGINAL
request had already carried one.

On a cold start it never does. The access token is deliberately never written to
disk — only the refresh token and session id are in the Keychain — so the first
request after a relaunch goes out with no `Authorization` at all. The 401
refresh then succeeded and minted a token, and the retry went out **still
uncredentialed**, 401'd a second time, and because that arrives as `isRetry` it
fell through as a hard error. A perfectly good stored session was reported dead.

This was a gap in the earlier fix, not a new regression: that one corrected a
*stale* header and never considered a *missing* one.

**Fix.** Gate on the client, not on the request: `session.holdsOwnCredential?.()`.
The retry now ADDS the header when there was none. Web is untouched — the marker
is absent there and its credential is a cookie.

**Verified.** A test that reproduces the cold start exactly, confirmed to fail
without the fix. And the full sequence against the **deployed dev API**:

| Step | Result |
|---|---|
| Sign in → refresh token + session id returned | pass |
| Cold start: refresh from the body alone mints an access token | pass |
| `GET /api/auth/session` with the new token | **200** |
| `GET /api/posts/feed` with the new token | **200** |

The server side was never wrong. 1494 frontend tests, lint and typecheck clean.

**Still unverified on device** — the phone has been disconnected throughout.

---

### Launch sequence and version gate — 2026-09-21 (later)

#### What the recording showed, and the four causes
Splash + logo → logo fades to **black** → logo again on **white** → pale flash
→ dark opening screen. The device was in **dark mode**, which is half the story.

| # | Cause | Fix |
|---|---|---|
| 1 | Splash released on the WebView's first draw — a BLANK frame | Waits for the launch shell to exist in the DOM, asked of the page |
| 2 | Every launch colour was `#FDFDFD` on a dark-mode phone | `values-night/colors.xml` → `#121212`, applied to splash, window and WebView |
| 3 | WebView with no background draws white | Set in `MainActivity`, follows night mode, re-applied on config change |
| 4 | Theme applied by React, long after first paint | Blocking inline script reads the same `localStorage.theme` before anything paints |

Verified inside the built APK: `launchBackground` resolves `() #fffdfdfd` and
`(night) #ff121212`; the shell carries `--launch-bg` and `color-scheme`; the
JS poll string is compiled in (`classes6.dex` — note it is not in `classes.dex`).

#### Icons
Maskable PWA icons were near-full-bleed, so the OS crop cut the mark. Now 0.42
of the canvas, inside the 80% safe circle, opaque. Added a `monochrome` layer
for Android 13+ themed icons. `logo-192/512.png` untouched — "any" purpose, and
`logo-512.png` is the generator's source.

#### Version gate
`GET /api/app/version` — **live on dev**, `cache-control: public, max-age=60`,
defaults `0.0.0` so it gates nobody. 26 tests on the comparison, 3 on the
endpoint.

#### ❌ Not verified on device
The phone was disconnected for all of this. Nothing below has been seen on
hardware:

1. Launch: no black frame, no white flash in dark mode, one continuous logo.
2. Launch in **light** mode (the `values-night` fallback path).
3. Sign in → stays signed in → kill → reopen → still signed in.
4. Launcher icon and themed-icon tint on the home screen.
5. Version gate: set `MOBILE_MIN_VERSION_ANDROID` above the installed build and
   confirm the wall appears, then unset it and confirm it clears.

```bash
adb install -r local/apk/dev/meetifyy-debug-2026-09-21.apk
```

---

### Mobile auto-logout and launch flicker — 2026-09-21

#### Auto-logout: four causes, all now fixed

| # | Cause | Where |
|---|---|---|
| 1 | Backend returning no tokens to the app | **not deployed** — now on `development`, dev deploy green, verified live |
| 2 | Boot gate asked "have I a session?" before the Keychain was read, and the answer is cookie-shaped | `transport.mayHaveCookieSession` + `AuthContext` boot |
| 3 | `whenReady()` awaited only for signup paths, so the first request **and** the refresh behind it went out empty | `transport.request` |
| 4 | The 401 retry replayed the **stale** access token, so a successful refresh was thrown away | `transport` retry |

`SessionSource.holdsOwnCredential()` is what the transport keys on. Web must not
await — its session is a cookie needing no load.

Verified against the **deployed dev API**:

| Check | Result |
|---|---|
| Login from the native origin returns access + refresh + session id | pass |
| `Authorization` + `x-session-id` on `/api/posts/feed` | **200** |
| Bare bearer | **401** — bypass still closed |
| Web origin gets tokens in the body | **no** |

#### Launch black screen: three native causes

1. `AppTheme.NoActionBarLaunch` set `android:background` on a `Theme.SplashScreen`
   parent — ignored by Android 12+, which reads `windowSplashScreenBackground` /
   `windowSplashScreenAnimatedIcon`. The icon older devices showed was
   **Capacitor's stock logo**, not ours.
2. `postSplashScreenTheme` was unset, so the activity kept the splash theme.
3. `AppTheme.NoActionBar` had no `android:windowBackground` → **black window**
   while the WebView started. That is the black screen.

`MainActivity` now installs the SplashScreen API and holds it until the WebView's
first frame (pre-draw listener, 4s backstop — a backstop, not a delay). Splash,
activity window and launch shell are all `#FDFDFD` with the same mark at the same
size, so the three handovers are invisible.

Verified in the compiled APK: all three splash attributes resolve,
`AppTheme.NoActionBar` carries `android:windowBackground`, the shell ships
`logo-mark.png`.

#### Opening screen
No change needed. `PublicRoute` already renders nothing while INITIALIZING and
redirects an authenticated user to `/home`. It showed the signed-out screen only
because auth resolved to signed-out. Adding a second gate would have hidden the
real bug.

#### ❌ Still to verify — needs the phone plugged in
Every fix above is verified in tests, in the compiled APK, or against the live
dev API. **None of it has been run on the device**, because the phone was
disconnected partway through. What to check once it is back:

1. Fresh install → sign in → stays signed in.
2. Kill and reopen → still signed in (this is the fix for causes 2–4).
3. Background → foreground → still signed in.
4. Logout → reopen → signed out, opening screen shown.
5. Launch: no black screen, no flicker.

```bash
adb install -r local/apk/dev/meetifyy-debug-2026-09-21.apk
```

---

### Building the dev APK

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

### Standing checks (run on every phase that touches `frontend/`)

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

### Phase 6a — Capacitor installed — **DONE**

#### Tested
- **C1 ✅ `npx cap sync` succeeds** — first item off the open board
- S1 ✅ 133/133 files, 1440/1440 tests · lint ✅ · boundaries ✅ · typecheck ✅
- Web build ✅ unaffected

#### Guards re-checked against the COPIED native assets
`cap sync` copies `dist-mobile/` into each platform. Verified the guards hold
there too, not just in `dist-mobile/`:

| | `android/…/assets/public` | `ios/App/App/public` |
|---|---|---|
| service worker / workbox | ✅ absent | ✅ absent |
| landing page | ✅ absent | ✅ absent |

#### Native projects are committed, deliberately
`cap add` can regenerate them, but only pristine. A store release edits them by
hand — permission purpose strings in `Info.plist`, permissions and deep-link
intent filters in `AndroidManifest.xml`, icons, splash, signing config — and all
of that is lost if they are treated as build output.

Ignored instead: Gradle/Xcode build output, `Pods/`, `.gradle/`,
`local.properties`, and each platform's copied `public/` (that is `dist-mobile`
again under another name — committing it would put two copies of the bundle in
every diff and let them drift).

#### Caught here
ESLint started linting the generated native projects: **14 errors**. Added
`android/**` and `ios/**` to its ignores. My own echo had said "lint clean"
while errors were printing above it — the echo was unconditional.

#### Scripts added
`mobile:sync` runs `build:mobile && cap sync` as one command — running `cap sync`
alone copies whatever happens to be in `dist-mobile/`, which silently ships the
previous bundle to the device.

---

### Phase 5 — wrap the website — **DONE**

**Course correction.** An earlier attempt built a separate mobile app: its own
router, screens, bottom nav, login and data hooks. That duplicated a website
which already exists and is already responsive. Those commits were reverted and
are not in this branch.

The native build now mounts the real app — same `App`, same providers, same
routes, same screens.

#### What actually differs between the two builds

| | Why it has to |
|---|---|
| Opening screen replaces `/` | The website's `/` is a landing page: marketing for someone who has not heard of Meetifyy. Someone opening the installed app has, and has installed it. One route, passed as a prop. |
| No service worker | A caching worker in a WebView can serve its copy of the *deployed site* instead of the reviewed bundle; iOS has no SW support at all. Absent from the config, not skipped at runtime. |
| No version gate | A bundled app has no deployment to be stale against. |
| No Vercel analytics | Reports to a web project; already host-gated there. |
| Native API origin | The web one derives the host from `window.location`, which reads `localhost` in a WebView. |

#### Tested
- S1 ✅ **133/133 files, 1440/1440 tests**
- S2 ✅ lint · boundaries ✅ · typecheck ✅ · both builds ✅
- Loaded at 375×812: launch shell lifts, **0 service workers**, opening screen
  renders, and **"Sign in" reaches the website's own login screen** — its
  gradient, wordmark, "Welcome back", password eye. Nothing rebuilt.

#### The bug this phase produced, and the trap behind it
The first version gated the API origin on `config.isMobileClient` — a property
on a runtime object. Rollup cannot fold that, so **the native origin shipped in
the web bundle and the 40 kB marketing landing page shipped in the app**.
Neither breaks anything at runtime, which is what makes it survive.

`config/index.js` already documents this exact trap for `IS_DEV_BUILD`:
> use this constant for anything that gates a lazy import or a whole dev-only block

Fixed by adding `IS_MOBILE_BUILD` beside it as a direct `import.meta.env`
comparison, which Vite replaces with a literal. Both bundles verified clean.

#### Two new CI guards, both proven to fire
- `dist-mobile/` must **not** contain `LandingPage-*.js`
- `dist/` **must** contain it

The failure is silent in both directions: the app carries a page it can never
route to, the website loses its front door.

#### Also fixed
`index.mobile.html` had the launch shell but not the script that lifts it, so
the app booted and then sat behind its own logo forever. `AuthContext` calls
`window.__meetifyyBoot.ready()` with optional chaining, so nothing threw.

Ten `@config` test mocks needed the new export — vitest fails the import
outright when a mock omits a named export, which is how they surfaced.

#### Left
- `cap init` / `cap add android ios` — needs the device toolchain
- The on-device spike: cookies vs bearer, back button, deep links, safe areas
- `@capacitor/app`, push, secure storage — Phase 6

---

### Phase 4a recheck — **DONE**

Everything from this session re-verified from a clean state rather than trusted.

#### Rebuilt from scratch
Both outputs wiped and rebuilt. Web: 153 assets, **byte-identical** to the
pre-Phase-4 baseline. Mobile: builds, and every asset its `index.html`
references exists.

#### The mobile bundle was actually loaded, not just built
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

#### Web dev server
Started and loaded: real app renders, correct title, no console errors. This was
the one path a `vite build` would not have exercised after the config refactor.

#### Alias extraction proven lossless
The pre-refactor alias map and what `sharedAliases()` produces were compared
programmatically: **10 vs 10, identical**.

#### Mobile bundle excludes every web-only heavyweight
framer-motion, emoji-mart, hugeicons, heroicons, socket.io, react-router,
html2canvas, workbox — **all absent**. 1.78 MB total.

#### CI validated by execution, not by reading
YAML parses; every multi-line `run:` block passes `bash -n`; the mobile job's
steps were then run verbatim and all passed.

#### Independence experiment (from the D5 exit criteria)
Deleted `src/mobile/`, `src/platform/capacitor/`, `index.mobile.html` and
`vite.mobile.config.js`, then built and tested the web app:
**build succeeded, 132 files / 1431 tests passed.** That is exactly 1 file and
9 tests fewer — the deleted Capacitor test and nothing else. Restored after.

#### Architecture rules re-swept
`core/` portability violations: **0**. `@capacitor` imports outside
`platform/capacitor/`: **0**. Mobile root importing the web root: **0**. Web
importing mobile: **0**. Singletons in `core/`: **0**.

#### Two mistakes found by the recheck itself
1. **My own audit script produced a false positive** — it reported `window` in
   `transport.js` because its comment-stripping regex only handled comments at
   line start, missing a trailing `// ... a far longer window`. ESLint was right
   and the script was wrong. Fixed before trusting the result.
2. **`base` was discussed in the mobile config's comments but never set.** It
   was already `/` by Vite's default, but a default is not a decision and a
   reader looking for it found nothing. Now explicit.

---

### Phase 4a — two build targets — **DONE**

A second client now builds from `core/` over `platform/capacitor/`, with its own
runtime and its own entry. Native projects (`cap add`) are **not** here — that
belongs with the on-device spike.

#### Tested
- S1 ✅ **133/133 files, 1440/1440 tests** (+1 file, +9)
- S2 ✅ lint · boundaries ✅ · typecheck ✅
- **S4 ✅ web `dist/assets` byte-identical — 153 files**, before and after
- `npm run build:mobile` ✅

#### The payoff, measured
`dist-mobile` is **1.82 MB** against the web bundle's 4.6 MB, because it pulls
in none of the landing page, framer-motion, emoji or icon sets — and because
`dropWebOnlyPublicAssets` removes the 15 iOS PWA splash screens (**1.14 MB**),
`robots.txt`, `version.json` and the OG image, which `publicDir` had copied in
wholesale.

#### B4 closed structurally
`vite.mobile.config.js` never loads vite-plugin-pwa, so there is no worker to
register. CI proves the absence: no `sw.js`, no `workbox`, no
`serviceWorker.register` in `dist-mobile/`. **Guards proven to fire** by
planting a fake `sw.js` and a fake localhost string and watching each trip.

#### B1 closed, and guarded by a test rather than a grep
`platform/capacitor/apiOrigin.js` returns the configured origin and probes
nothing. 9 tests install a **real WebView-shaped `window`** (`https://localhost`
and `capacitor://localhost`) with `preferLocalBackend: true` — the exact
conditions that break the web implementation — and assert the answer is
unaffected.

#### Three of my own mistakes, caught here
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

#### Left for Phase 4b / 5
- `cap init` + `cap add android ios` — needs the device toolchain; yours
- `platform/capacitor/` storage re-exports the web implementations, which is
  correct today (a WebView has DOM storage) and becomes `@capacitor/preferences`
  in Phase 6
- Mobile session source still the web one — the spike decides cookie vs bearer
- No mobile UI yet (Phase 5); `src/mobile/main.jsx` renders a placeholder shell

---

### Phase 3e — transport into core/ — **DONE**

`shared/api/apiClient.js` is now **155 lines of assembly**, down from 1,639 at
the start of Phase 3. The transport is `core/api/transport.js`, a factory.

#### Tested
- S1 ✅ **132/132 files, 1431/1431 tests** (+1 file, +14)
- S2 ✅ lint · boundaries ✅ · typecheck ✅ · build ✅
- S4/S4b n/a — a factory wrapper is not a byte-identical move

#### The proof
- **Boundary lint passes on `core/api/transport.js`.** It is subject to the same
  rules as every other core module: no DOM, no `import.meta.env`, no React, no
  router, no imports back into client code.
- `grep` for browser globals in the transport finds **9 matches, all in
  comments**; zero real references. Client imports: **0**.
- The 14 new tests run in the default `node` environment — **no `window`, no
  `document`, no `localStorage`**. A transport that still depended on one could
  not construct, so the environment is half the assertion.

#### What the tests pin
Not the request path (the app's own suites cover the 401 retry, conditional
requests and failover against the real thing) but the property nothing else
checks: **two transports are independent**. Separate origins, separate CSRF
tokens, separate failover flags, separate store purges. If those ever share,
web and mobile would be one client wearing two names.

#### `no-undef` earned its place
The extraction dropped the `core/api/paths` import. Four `no-undef` errors —
`SAFE_METHODS`, `isBearerPath`, `isPublicPath` — caught it before any test ran.
That is the rule the lint config says it exists for, doing exactly that job.

#### Measured
Entry chunk **533,395 → 533,973 (+578)**, the factory-wrapper cost again.
Cumulative since 3a: **+1,472 bytes (+0.28%)**.

#### Left
- Contract tests vs a live backend (needs a running backend)
- Per-namespace endpoint split (pays off in the mobile bundle, not on web)
- `dependency-cruiser` (wants a real zone matrix, i.e. `src/mobile/`)
- Full TS in `core/` (Phase 10, RN prerequisite)
- `platform/capacitor/*` — Phase 4. Each is now one small sibling file.

---

### Phase 3d.2 — CI enforcement, dead stores, logout purge — **DONE**

#### Tested
- S1 ✅ **131/131 files, 1417/1417 tests** (+1 file, +4)
- S2 ✅ lint clean · typecheck ✅ · boundaries ✅ · perf ✅ 3/3 no errors
- S4 n/a (behaviour change), proven by a guard test instead

#### CI now enforces the boundaries
Two **blocking** steps added to the `frontend` job, before the existing
non-blocking lint:
- `npx eslint src/core src/platform --max-warnings 0`
- `npm run typecheck`

The full lint stays `continue-on-error` because of an unrelated warning backlog
— which is exactly why the boundary rules needed their own step, or they would
be reported and ignored. Both simulated locally before committing.

#### Two dead stores deleted
`postStore.js` and `savedPostsStore.js` held server-derived bookmark ids,
persisted them to `localStorage`, and were **read by nothing**: zero hook
subscriptions outside the store files. Post save-state comes from the post
object via `toggleRegistry`; the Saved page uses its own `['bookmarks']` query.

Worse than dead weight: `hydrateSessionMeta` fired a **`getBookmarks(50)`
request on session restore** to fill one of them.

`savedActivitiesStore` is genuinely used (4 components) and is left alone.

#### Correction to what I claimed in 3d
I described these stores as a privacy leak. **That was wrong** — `clearAll()` on
logout does propagate through zustand's persist middleware, so the persisted
copy was already being cleared. The real defect was that they were dead and
costing a network request.

#### The actual privacy gap, found while checking that
**The React Query cache was never cleared on sign-out.** `queryClient` was
obtained in `AuthProvider` and used only for `propagateUserMedia`. With
`staleTime: 30s` / `gcTime: 15min`, the next person to sign in on a shared
machine could be rendered the previous person's feed, messages, notifications
and profile from memory until each query refetched.

Fixed in `resetClientStateForNewUser`, which covers both sign-out and
account-switch. **Guard test proven**: with the fix disabled, 3 of its 4 cases
fail; the 4th is the negative case and correctly still passes.

#### Bug I introduced and the test caught
First version put `queryClient` in the `useCallback` dep arrays. A test double
returning a fresh object per call turned that into an infinite re-render.
Real `useQueryClient` is stable, but depending on that identity is needless —
now held in a ref with `[]` deps.

#### Measured — this phase paid for itself
Entry chunk **534,688 → 533,395 (−1,293)**; precache **−10.63 KiB**.
Cumulative since 3a: **+894 bytes (+0.17%)**, down from +2,187.

---

### Phase 3d — close the open items from 3a–3c — **DONE**

Every leftover recorded below that was a genuine gap rather than a stated
deferral. The transport is now free of client imports and browser globals.

#### Tested
- S1 ✅ **130/130 files, 1413/1413 tests** (+2 files, +16)
- S2 ✅ eslint clean · S3 ✅ build · typecheck ✅ exit 0
- Auth/API suites run explicitly: **24 files, 204 tests** — these are the ones
  that exercise the rewired 401/refresh/ETag/session paths
- **perf suite: 3/3 with no unhandled error** (was 3/3 + 1 error)

#### Closed
| Was open | Now |
|---|---|
| Transport coupled to Supabase | `platform/web/sessionSource.js` — the subscription, the seed and all three recovery guards in one place |
| Transport coupled to legal-consent + account-status | `TransportHooks.onApiErrorCode`; the transport reports a code, the app decides what it means |
| `platform/web/keyValue.js` not written | `platform/web/storage.js` — sync stores, cookie reader, DOM-event hooks |
| ETag store direct `sessionStorage` | `core/api/etagCache.js` over an injected `SyncKeyValueStore` |
| Async/sync contract mismatch | Resolved in the contract: `SyncKeyValueStore` added, with the reason written down (a bridge call per GET is latency on every screen) |
| Perf mock missing `listQueue` | Fixed; the profile was being taken while a hook threw |

#### Verified outcome
`grep` for browser globals in `apiClient.js` code: **none**. All 7 client
imports are used only in the composition-root block at the top of the file. The
one exception is `API_PROXY_PREFIX`, a config constant re-exported for the
socket store — config reading is the composition root's job.

#### Behaviour changes, deliberate
- **ETags are now cleared on logout.** They were not before. Stale validators
  belonging to a previous user surviving into the next session on a shared
  device is the same class of problem as T2. Safe direction: the worst case is
  a re-fetch instead of a 304.
- `window.__api_redirecting` removed — written once, read nowhere.

#### Bug I introduced and caught mid-phase
Replacing `applyAccountStatusCorrection` with the hook left the legal-consent
block still inline, so `announceLegalConsentChange` would have fired **twice**
per gated 403. Caught by re-grepping for the coupling after the edit.

#### Measured
Entry chunk **533,787 → 534,688 (+901)**. Cumulative since 3a: **+2,187 bytes
(+0.41%)**.

#### Still open, deliberately
- The transport is decoupled but still **lives in `shared/`**. Making it
  literally portable means splitting this file into `core/api/transport.js`
  (factory) + `shared/api/apiClient.js` (root). Near-mechanical now; it was not
  before.
- Contract tests against a real backend
- Per-namespace endpoint split to restore tree-shaking (worth it for the mobile
  bundle, not for web)

---

### Phase 3c — route policy, media URLs, ApiOrigin seam — **DONE**

Moved `PUBLIC_PATHS`/`BEARER_PATHS`/`SAFE_METHODS` and the media-URL helpers
into `core/`, and put every `window.location` question behind
`platform/web/apiOrigin.js`.

#### Tested
- S1 ✅ **128/128 files, 1397/1397 tests** (+2 files, +50)
- S2 ✅ eslint clean  · S3 ✅ build  · typecheck ✅ exit 0
- S4 / S4b ❌ neither applies — `getMediaUrl` was restructured, not moved.
  Verified by behaviour tests instead (50 new assertions).
- Boundary lint ✅ `core/api/paths.js`, `core/api/media.js` clean

#### B1 — second instance found and closed
`getMediaUrl` contained the **same** `window.location.hostname` reasoning as
`directBackendUrl`. In a WebView the page hostname is `localhost`, so every
private-origin media URL would have been rewritten to
`capacitor://localhost:4000/…` and every such image would have failed. Now a
platform decision (`ApiOrigin.privateMediaTarget()`), with an explicit
regression test asserting a native client never produces a localhost URL.

#### Test fixed, not worked around
`src/config/__tests__/publicPostAccess.test.js` asserted by **slicing the source
text** of `apiClient.js` for `const PUBLIC_PATHS = [`. Moving the list broke it.
Rewritten to call `isPublicPath()` — which is what it actually cared about, and
which would also have caught a rename that kept behaviour correct. Negative
cases added.

#### Measured, accepted
Entry chunk **533,183 → 533,787 (+604)**. Cumulative from Phase 3a: **+1,286
bytes (+0.24%)**.

#### Left / not covered
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

### Phase 3b — apiClient split — **DONE**

The 20 endpoint namespaces moved out of `shared/api/apiClient.js` into
`core/api/endpoints.js` as a factory over an injected transport. The transport
stays where it is: it is the half that reaches into Supabase, the config object,
the legal-consent bus and account-status correction.

**S4 does not apply to this phase and that is not a pass.** Splitting a module
changes the module graph, so 81 of 153 chunk hashes changed. S4b was used
instead.

#### Tested
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

#### Measured regression, accepted
Entry chunk **532,501 → 533,183 bytes (+682, +0.13%)**. The 20 namespaces were
individually tree-shakeable module bindings; they now return together from one
factory, so none can be shaken alone. Recoverable by splitting
`endpoints.js` into one file per namespace — worth doing when the **mobile**
bundle needs it (it will construct only what it uses), not for 682 bytes on web.

#### Left / not covered
- Transport still in the legacy zone, still coupled to Supabase / `@config` /
  legal-consent / account-status. Inverting those is what a second client needs
  and is **not** done.
- `platform/web/` adapters (`keyValue`, `csrfCookie`, `apiOrigin`) not written
- No contract tests against the real backend yet
- 107 importers unchanged by design — they still import from
  `@shared/api/apiClient`, which re-exports all 20

---

### Phase 3a — scaffolding, contracts, boundary lint — **DONE**

Scope note: the ~19 pure domain/validation/constant files were **not** moved.
Nothing consumes them from `core/` yet, and the instruction is to extract only
what the apiClient split and the first mobile screens actually need. They move
in 3b and 5, pulled by a real consumer.

#### Tested
- S1 ✅ **125/125 files, 1339/1339 tests** (was 124/1296; +1 file, +43 tests)
- S2 ✅ eslint clean
- S3 ✅ build exit 0
- S4 ✅ **153/153 assets identical to the Phase 2 build** — new modules are
  unreferenced, so the web bundle is provably untouched
- S5 ✅ 195 entries / 5564.13 KiB
- S6 ✅ only intended files
- `npm run typecheck` ✅ exit 0 (`strict`, `noUncheckedIndexedAccess`)

#### Boundary lint — proved by deliberate violation, not by assumption
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

#### Caught during this phase
- `noUncheckedIndexedAccess` found a real unchecked-index bug in
  `parseIntentFromPath` (`split('?')[0]` chaining). Fixed. This is the concrete
  argument for these two files being typed.
- ESLint flat-config precedence bug in my own first draft: a later block with
  the same rule key replaces an earlier one, so the general Capacitor block was
  silently overriding `core/`'s stricter `no-restricted-imports`. Reordered so
  the specific block comes last.

#### Left / not covered
- Boundary lint not in CI yet (Phase 4 adds path-filtered CI)
- `**/*.ts` is excluded from ESLint — `npm run typecheck` covers those two files
  instead of adding typescript-eslint for them
- No `dependency-cruiser` graph yet — worth it when `src/mobile/` exists
- `core/` is JS apart from the 2 contract files; full TS is Phase 10

---

### Phase 2 — remove dead resolve aliases — **DONE** (`849c86b`)

#### Tested
- S1 ✅ 124/124 files, 1296/1296 tests
- S2 ✅ eslint clean
- S3 ✅
- S4 ✅ **153/153 asset files identical name + sha256**, before vs after
- S5 ✅ 195 entries / 5564.13 KiB both builds
- S6 ✅ only `vite.config.js` + `vitest.perf.config.js`

#### Left
Nothing. Configuration-only; no source file changed.

#### Known pre-existing, NOT introduced here
`src/__perf__/instantmatch.perf.jsx` logs an unhandled
`default.listQueue is not a function` — incomplete `matchSocketClient` mock.
Confirmed identical on unmodified `development`. Perf tests still pass 3/3.

---

### Phase 1 — Capacitor spike

#### Part 1A — dev CORS matrix — **DONE** (2026-09-20, no config change, no credentials)

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

#### Part 1B — needs a dev test account — **NOT RUN**
Only cookie-attribute inspection and socket-with-real-token remain; the
on-device spike covers both.

#### Part 2 — on-device — **NOT RUN** (owner-executed)
Runbook: `spike-capacitor-runbook.md`, tests 1–14 (the runbook was never kept in the repository).
**Test 1 is the highest-value measurement in the programme**: what `Origin`
header, if any, the WebView sends. If none, native needs no CORS change in any
environment.

#### Verified during runbook authoring
- Staging script refuses a production `dist/` and stages nothing on refusal
- `dist/index.html` is the prerendered homepage; `dist/app.html` is the SPA shell
- `--viewport-fit` patches the staged copy only

---

### Assumptions still unmeasured

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

### Test gaps in the codebase (not scheduled)

| Gap | Note |
|---|---|
| No browser e2e | Playwright proposed for Phase 9 |
| No native e2e | Manual scripted checklist first |
| No contract tests vs the backend | Proposed Phase 3b, once `core/api/endpoints` exists |
| ESLint non-blocking in CI | `continue-on-error: true` for backend and frontend jobs |
| Backend: 155 spec files, 2 e2e | not touched by this programme |

---

### Live local APK installation mistakes (2026-09-27)

During local USB testing, the agent made these mistakes:

1. Installed the normal bundled debug APK when the user wanted a live local
   APK. The bundled frontend could not provide live edits.
2. Selected the alternate mobile server on port 3002, despite the user's
   designated mobile APK server being port 3001. The original 3001 process was
   configured for the remote development API; its port did not imply local API
   configuration.
3. Packaged `server.url` with `/index.mobile.html`. This loaded the mobile HTML
   but left that filename as React Router's application path. A real-device
   screenshot showed "Page not found" with the website-style header.
4. Initially treated successful builds and installations as sufficient without
   confirming the launch screen on the phone.

The corrected local artifact is `local/apk/live/meetifyy-live-local.apk`.
Its embedded `assets/capacitor.config.json` was inspected and its launch URL
corrected to `http://localhost:3001/`. The running mobile Vite configuration
was checked for `VITE_CLIENT=mobile` and `VITE_API_URL=http://localhost:4000`.
USB reverse forwarding connected ports 3001 and 4000. The extra 3002 server
and its forwarding were stopped; both remaining app servers responded.

The corrected APK was installed and restarted. A device screenshot confirmed
the mobile login screen, replacing the erroneous Not Found screen. This was
a launch-screen check, not verification of every authenticated feature or
of successful login. The committed Capacitor config was left without a live
server URL, and temporary generated configuration was restored after packaging.

Future installation requests in this workflow must use the live artifact,
verify its embedded URL and the running server's API target, and inspect the
device before claiming that the intended screen is working. These rules are
also summarized in the repository's root `AGENTS.md` so subsequent agents
read them at the start of work.


---

### System bars, page transitions, profile loading, reply bar (2026-09-29)

Measured on the I2208 (Android 14, WebView 153, 3-button navigation) with
`adb shell screenrecord` (720x1604) and per-frame pixel sampling of the status
bar, header and navigation bar.

**Before** (page changes that the bars had to follow):
- Crew -> Create Activity: the navigation bar went black ~500 ms *before* the
  status bar, while the page was still Crew.
- Campus -> Notifications: the status bar kept Campus's red for ~70 ms.
- Settings: navigation bar strip light blue under a white page.
- Profile: cover pop-in ~200 ms after the page, fading in from a pale shimmer.

**Root cause:** the bars were native, painted with a colour the page measured
about itself (`elementsFromPoint`) in an idle callback and sent over the bridge.
Two systems, two clocks.

**After:** status bar, header and navigation bar change in the *same frame* on
every navigation in light and dark (12 consecutive routes, plus 13 routes at
120 ms spacing; attributes returned to baseline afterwards).

**Keyboard on Create Activity:** opening showed a white patch (window colour)
above the sliding keyboard for ~30 ms; closing (after a per-frame-resize
experiment) showed the light document canvas behind a dark page. Fixed with
`setWindowColor` + `useSystemBars({ canvas: true })`; verified by recording both
directions, on a dark page and on Search (light).

**Not verified on the device:** Activity Detail and the Video viewer (the dev
database has no activities and no video posts). Their CSS was changed the same
way as Create Activity and the Image viewer, which were verified.

**Harness (local scratchpad, not committed):** `screenrecord --size 720x1604`,
`ffmpeg -vsync 0` to frames, `ffprobe` for timestamps, Chrome DevTools Protocol
through `adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>` to
navigate (`history.pushState` + `popstate`), read computed styles, and run an
audit that lists interactive elements intruding into the navigation-bar zone.

**Found on the development APK (2026-09-29): Instant Match "Reconnecting" and
localhost share links.** Both are old and neither is a local-vs-dev mix-up: with
no local server and no port forwards the app talked only to
`dev-api.meetifyy.app`. (1) The socket handshake completed (`40{sid}`) and the
server answered with `41` at once: the gateway required the session id from a
*cookie*, which a WebView never stores, so every native socket was accepted and
then disconnected. The client now sends `sessionId` in the handshake payload and
the gateway accepts it through the same ownership/liveness lookup. (2) Links
shared from the app were built on `window.location.origin`, which inside the
app is `https://localhost`; they now use `VITE_SITE_URL` (`publicOrigin`).

**Audit for the same two classes (2026-09-29).** "Origin is `https://localhost`"
and "credential only accepted as a cookie":
- `AuthController.currentSessionId` read only the `mf_sid` cookie, so for the app
  it was always null: *Sign out other devices* and *change password* revoked
  every session including the caller's own, and the device list marked no current
  device. It now falls back to `x-session-id` (cookie still wins).
- `supportApi.uploadAttachment` and the direct-upload PUT sent a bare bearer
  token, which the guard refuses; both now send `x-session-id` on native.
- Checked and fine: `classifyMeetifyyURL` (internal domains are configuration),
  `VoiceMessagePlayer` (cross-origin detection is correct for the app),
  `AuthContext` host comparison, `config.app.siteUrl` (set in every env file),
  `web-only` `window.location.href` uses, CORS for the socket (polling worked).

**Socket fix, second half (2026-09-29).** After the gateway accepted the session
id the app still reconnected: the connect packet carried `sessionId` but no
`token`, because on the installed app the token lives in secure storage, not in
the React `session` `SocketManager` reads. The handshake now takes
`token || getAccessToken()` at every connection. Verified on the development APK
against the redeployed dev API: no `41` disconnect, all `socket.io` requests 200,
the WebSocket upgrade completes (`2probe`/`3probe`, then presence frames), the
UI no longer says "Reconnecting", and Share -> Copy link yields
`https://dev.meetifyy.app/post/<id>`. One emit sent immediately on connect still
gets a single transient `Unauthenticated` (the gateway authenticates after it
acks the namespace); the client recovers on its own and it predates this work.

### Post composer motion (2026-10-01)

The shared web/Capacitor composer now uses a synchronized 180 ms CSS transition
for the expandable row and its controls, without the previous staggered delays.
An unpadded clipping wrapper lets the collapsed grid row reach zero height;
previously the grid item's padding retained 12 px. Collapsed actions become inert
and hidden from assistive technology immediately, including during the closing
transition. Reduced-motion preferences disable the transition.

Research: web.dev's [animation guide](https://web.dev/articles/animations-guide)
recommends transform/opacity and warns that size animation requires layout.
The small expandable row still animates grid size to move the feed naturally;
this is not a compositor-only animation. No animation library, native bridge,
JavaScript size measurement, or per-frame JavaScript loop was added to the app.

A local Chromium fixture using the actual composer CSS and 35 dummy post cards
was checked at 390 px and 1280 px widths. Both old and new versions sampled
approximately 17 ms maximum frame intervals on this computer; this is not
proof of improved frame rate. The new version reached 0 px when collapsed
(previously 12 px), settled at the same 60 px expanded action height after rapid
reversals, and reported 0 s transition duration with reduced motion. The fixture
is under git-ignored `local/composer-motion/` and does not represent a full
application or keyboard performance test. The mobile development bundle built
successfully and contains the new clipping-wrapper styles. No APK installation
or real-device recording was performed for this change.

#### Media viewer close lifecycle (2026-10-01)

Fixed the shared viewer header remaining visible during the 280 ms media exit.
Closing now immediately hides header, navigation, counter and video controls,
makes the exiting overlay inert, pauses mounted videos, and closes the menu.
Close timers are guarded against duplicate requests and cleared on unmount or
new media sessions; reduced-motion dismissal skips the animation wait.

Five regression cases cover immediate closing state, immediate video pause,
duplicate dismissal, stale-timer cancellation/reopening and reduced motion.
A local Chrome CSS fixture at 390 px and 1280 px widths verified visibility
hidden, opacity 0 and transition duration 0 s for all chrome on the first exit
frame. This fixture is not an authenticated application or real-device test.
A separate source audit, with W3C/web.dev research, is saved locally at
`local/media-viewer-audit/report.md`; its remaining findings are not fixed here.

Validation: all 163 frontend test files / 1,653 tests passed, including the five
new close-lifecycle cases. Frontend lint, typecheck and mobile development build
passed. Backend code is unchanged; the backend suite passed earlier in this
session. No APK was rebuilt/installed and no device recording was performed.

#### Media viewer frontend follow-up (2026-10-01)

Restricted autoplay/registry ownership to the current video, with unique IDs,
metadata-only neighbor preloading and immediate pause on deselection/closing.
Added image signing error/retry handling and fixed public-URL retry resolution.
Removed the unsupported owner Delete menu item and its false success toast.
Downloads now resolve through the authorized media cache without modifying
signed query parameters. Image measurement no longer toggles transforms.
Added viewer focus containment/background inertness/opener restoration across
portalled menus and nested dialogs. Hidden controls/slides are inert; keyboard
shortcuts no longer act on neighboring videos or duplicate slider/button input.

All 165 frontend files / 1,661 tests passed, including playback, image recovery,
authorized download, focus, and close lifecycle regression cases. Lint,
typecheck, and web/mobile development builds passed. A Chrome fixture using the
actual focus hook verified Tab wrapping, hidden-control exclusion, background
inertness, nested dialog focus/restore and opener restoration. This is not an
authenticated end-to-end or real-device test. No backend/native project files
were changed. Remaining deletion/caption data integration, native saving and
verification gaps are listed in `local/problemfound.md`.

New message modal: selected recipient rows now keep a transparent background,
including hover; selection checkmarks remain. A Chrome fixture using the actual
stylesheet verified the selected-row background; lint/typecheck passed after
this CSS change.

---

### Profile: fast flicks stalled (2026-10-11)

Measured on the I2208 (Android 14, WebView 154, 60 Hz) with `adb shell input
swipe` flicks, `dumpsys gfxinfo` frame counts, screen recordings, and CDP
traces/CPU profiles of the installed debug app.

**Symptom:** on the Profile page a fast flick moved the page for ~100 ms, froze
for ~1.6 s, then jumped to where the fling would have ended. It coincided with
the bottom nav starting to hide (~64 px into every flick), which is why it read
as "the nav stops the scroll". Home, with the same nav logic, flung normally.

**Root cause:** the page's scroll-driven animations (`animation-timeline:
scroll()/view()`: cover scroll-away, blur crossfade, title, avatar recede,
name/handle fade). On a freshly mounted Profile, any ONE of them was enough:
the compositor queued and coalesced the fling's scroll updates and released
them in one burst. Cancelling all of them restored the fling; cancelling any
subset did not. Earlier profile work measured slow drags, not flings, so it
never showed.

| fresh mount, one flick | frames rendered |
|---|---|
| before (scroll timelines) | 13, 14, 13 |
| after (variables written from the scroll position) | 103, 105, 105, 105 |

Screen recording of the same flick: 10 moving frames with a 1.67 s gap before,
101 moving frames with no gap over 20 ms after. Flick back up from the bottom:
127 frames, nav shown again.

**Fix:** `useCollapsingHeader` now writes the values from the scroll event itself
(`--cover-shift`, `--cover-blur`, `--collapse`, and `--exit` on elements marked
`data-exit-track`), onto the few elements that read them. No `animation-timeline`
anywhere. Sizes are measured on mount/resize only, not per scroll event.

**Second cause (idle, not flings):** the post media skeleton animated
`background-position` forever, on every tile that had not loaded, including
lazy carousel tiles scrolled out of sight. A background-position animation
cannot run on the compositor, so a profile with a few multi-photo posts kept
the main thread rendering every frame while idle (229 main frames in 4 s, ~40%
of main-thread time). It is now a translated highlight layer: 0 main frames in
4 s idle.

**Also measured after:** drag-scroll janky frames ~4% -> ~1.5%, p99 frame time
22-24 ms -> 19-21 ms; cover, blur crossfade, title hand-over and avatar recede
match the previous build at scroll 0/30/60/75/100/160/220/300 px and in
consecutive frames of a swipe; pull-to-refresh zoom/indicator/settle intact.
2088 frontend tests, typecheck and lint pass.

**Measuring this:** the stall only appears on a fresh mount (leave Profile and
re-enter), so measure that way. Do not edit stylesheet rules through the CSSOM
to bisect: the edits persist across remounts and contaminate later runs.

**Follow-up (same day): the header edge sliced the avatar.** With scrolling smooth,
the opaque header band's bottom edge visibly cut the avatar, the cover's edit
button and the name flat as they slid underneath it (the original design, only
more noticeable now). `--exit` now reaches 1 when an element's top edge touches
the header (fade over `data-exit-lead` px, default 40), so they are gone before
the edge reaches them; the edit button is also made inert once mostly faded.
Verified on the I2208 at 0/15/30/52/75/110/150/230 px: nothing sliced, title
hands over from the name; fresh-mount flick still 105 frames.

**Follow-up 2: avatar pinned on the header line.** The fade-before-the-edge version
made the avatar vanish within ~25 px of scroll. It now sticks (`position:
sticky`, exact, no lag) with its top on the header's bottom line the moment it
touches it, and keeps shrinking (to 45%, toward the line) and fading over the
next 110 px, never going behind the header (measured on the I2208: avatar top
88 px = header bottom 88 px). Fresh-mount flick unchanged at 105 frames. The
name now starts fading 70 px before it reaches the line, so it clears the avatar.

#### Profile: sticky cover container + pull (2026-10-11, follow-up 3)
- Header background vanished once posts reached it, and a pull showed a black band above the cover. Cause: the sticky cover was bounded by `.profileCard` (ended before the posts) and the card's `overflow: clip` cut the pull zoom. Fix: in the app the card is `display: contents`, its look moved to `.profileInfo`; the cover's container is now the whole column.
- Also `useSystemBars({ scrollThrough: true })` on Profile (device nav bar clears with the app nav).
- Verified on the phone (APK): header cover stays pinned through 2 long flicks; mid-pull the cover fills to the top, zoomed and blurred, no dark band; settles back to normal. Not re-run: full suite.

#### Community view: pull, safe area, 250-char description, nav bar (2026-10-11)
- Pull-to-refresh: Community View already had the wrapper, but it wrapped only the hero, so the posts below stayed put and the cover never filled the gap. Now wraps hero + posts, gives the pull to the header (`pullTargetRef`), zooms the cover about its bottom edge (whole `.heroCover`, so a gradient-only cover fills too) with a blurred layer faded in by the pull. Same mapping as Profile.
- About ("community details") sheet: header now pads by `--status-bar-inset`; it sat under the clock.
- Description limit 250 everywhere (create modal, admin modal, DTOs): shared `COMMUNITY_DESCRIPTION_MAX` (frontend `shared/constants/communityLimits.js`, backend `communities/community-limits.ts`). The edit form already said 250 but the API refused >200. DB column is unbounded text: no migration. Tests at 199/200/201/249/250/251. (`bio` 200 on users is the profile bio, not a community description: left alone.)
- Device nav bar: Community View calls `useSystemBars({ navigation: 'transparent' })` (page has no bottom nav). Verified `html::after` is transparent on device.
- Not reproduced: bottom-nav flicker when tapping the composer. /communities/:id renders no app BottomNav at all (`removeBottomNav`), and a 12 fps screen recording of the post-composer tap showed no bar. Comment composer not exercised (no posts in the test community).

#### Background shade shifted when the keyboard opened (2026-10-11)
- Cause: html/body/#root paint a viewport-centred radial gradient; the keyboard shrinks the WebView, so the gradient was recomputed for the shorter viewport. Fix (app only, `mobile/mobile.css`): size it to the keyboard-free `--app-vh`, anchored top, no-repeat.
- Verified on device (Community View, composer tap): background pixels at x=3, y=900/1100/1250/1400 were (239,244,252)/(241,246,252)/(241,246,252)/(240,245,252) before the keyboard and, after the fix, identical with it open; before the fix they became (231,240,251)/(226,237,250)/(221,234,249)/(214,230,249). Only the Community page was checked; dark theme not checked.

#### Community pull: cover zoom was ~100x (2026-10-11)
- Cause: the zoom is `1 + pull / --profile-cover-h`, and only Profile's cover header ever wrote that variable; on Community View it fell back to 1 (scale 30-107x measured over CDP = flat colour). Fix: CommunityView measures the cover (`offsetHeight`, ResizeObserver) and sets the variable on it.
- Verified on device over CDP + screenshots: scale 1.43 / 1.56 / 1.65 at pull 57 / 74 / 86 px, blur opacity 0.48 / 0.62 / 0.72 (min(1, pull/120), same as Profile); the picture visibly zooms and softens, settles back at rest.

#### Community details page + keyboard backgrounds (2026-10-11)
- Details (About) page: slides in from / out to the left (`aboutInFromLeft/aboutOutToLeft`, not the shared `slideUp`), and Back closes it only (`useOverlayBack`); verified on device: Back left the path at /communities/<id> with the overlay closed.
- Create Activity: the keyboard shrinks the fixed page and its ambient backdrop (percentage-sized radial gradients) was re-laid-out, shifting colours (left-edge pixel 93,49,37 -> 44,37,39 -> 0,0,0 across the open). `.ambientBg` is now pinned to `100 * --app-vh`; pixels at 3 heights stayed the same over frames 6-28 of the recording.
- Community composer "blank space": it is the WebView resizing a few frames before the keyboard draws; the gap shows the native window colour, which was the gradient's darkest edge (214,230,249), a blue slab under white cards. `readPageEdgeColors` now also returns `window` (gradient at ~60% height, where the keyboard's top lands) and installSystemBars uses it for `setWindowColor`; the gap now reads as the page (near white). The gap itself remains (native: IME animates after resize); dark Create Activity still shows a black gap for ~2 frames.

#### Keyboard blank strip, community pull shading, details slide (2026-10-11)

> **Superseded 2026-10-13 (`d65d4799`):** the per-frame IME padding described
> below was replaced by overlay mode — the WebView no longer resizes for the
> keyboard and the page lifts itself on one `meetifyy:ime` event. Current
> design: [MOBILE_APP.md](MOBILE_APP.md#4-native-ui-behaviour).

- Root cause of the blank space when the keyboard opens (every screen): `SystemUiPlugin` set the decor's bottom padding to the FINAL IME inset at once, so the WebView shrank before the keyboard had moved and the keyboard's whole slide (~250 ms) showed the window colour. Now a `WindowInsetsAnimationCompat` callback follows the IME frame by frame while it opens (onProgress -> padding = current ime.bottom); closing keeps the old instant behaviour (grown per frame, the uncovered strip was not repainted until the end).
- Verified (community composer, screenrecord + per-frame pixels): opening - content stays right above the rising keyboard, no blank frames (was ~5 frames of flat colour). Closing - still ~5 frames where the area the keyboard uncovers shows the page background before the page repaints (renderer resize latency; not fixed). Window colour = page gradient where the keyboard's top lands, so that strip reads as page background.
- Community pull: the header's legibility shade (`.header::before`) slid down with the pull as a dark band with a hard edge across the zooming cover; now counter-translated so it stays at the top. Checked light + dark.
- Community details page: slides in from / out to the right (`aboutInFromRight/aboutOutToRight`).
- Not React Native: KeyboardAvoidingView does not apply (Capacitor 8 WebView). iOS not tested (no device).

---

## Mobile auth: the options, at diff level — 2026-09-21

> **Historical design note.** Written before implementation. **Option A was
> implemented** (session-bound bearer tokens with `x-session-id`), with one
> difference from the proposal below: the server decides whether to return
> tokens in the body by the request's `Origin` (`isNativeAppClient`), not by a
> client header. Current design: [SECURITY.md](SECURITY.md#3-the-installed-app-session-bound-bearer-tokens).
> Line numbers refer to the code at the time.

**Status:** decision needed. Nothing here is implemented.
**Written:** 2026-09-21, after the first on-device run.

---

### The problem, measured

On a vivo I2208 (Android 14, WebView Chrome 153), running the debug APK:

1. `POST /api/auth/login` **succeeds** — `201`, full user object in the body.
2. The server sets all four cookies, each `Secure; SameSite=Strict`, `Domain=.meetifyy.app`.
3. Chrome **blocks all four**:
   ```
   BLOCKED  mf_access, mf_refresh, mf_sid, mf_csrf
   reasons: ["SchemefulSameSiteStrict"]
   ```
4. Cookie jar afterwards: **empty**.
5. Every authenticated request 401s. `/api/auth/session/refresh` 401s. The app
   falls back to `/`.

**Why.** The WebView page origin is `https://localhost`. The API is a different
site, so the request is `sec-fetch-site: cross-site` (measured, not inferred). A
browser will not store a `SameSite=Strict` cookie from a cross-site response.

`Domain=.meetifyy.app` is **not** a factor. It domain-matches the API host, which
is what the rule is about; it is legal here.

**There is no fallback today.** `POST /api/auth/login` returns
`{ user, meta, csrfToken, sessionId }`. The access token exists **only** inside
the HttpOnly cookie, so a native client has no credential it can hold.

---

### The constraint that rules out the obvious fix

The naive version of "use bearer tokens on mobile" is to put `@AllowBearerToken`
on the authenticated routes. **That re-opens a vulnerability that was
deliberately closed**, and the code says so in as many words
(`src/common/decorators/allow-bearer-token.decorator.ts`):

> Adding this decorator to any other route re-opens the bypass for that route.

The bypass: a Supabase access token is a self-contained JWT, valid for its full
hour on signature alone, naming no session. The session table is what makes
"sign out this device", "sign out everywhere" and password-change revocation
real, and it can only be consulted for a request that **names a session**. A
bearer caller named none, so the revocation check was skipped entirely — moving
a token from the cookie jar into an `Authorization` header defeated every one of
those controls for up to an hour.

Today that check lives in `jwt.guard.ts` and is gated on `usedCookie`, reading
`mf_sid` from the cookies.

**So the real question is not "cookie or bearer". It is: can a mobile credential
name a session?** It can, and that is what makes Option A sound.

---

### Option A — session-bound mobile tokens (recommended)

Mobile holds a token **and** a session id, so the guard runs the *same*
revocation check it runs for cookies. Bearer becomes as revocable as cookie
rather than an exemption from revocation.

#### Backend

**`src/common/guards/jwt.guard.ts`** — the only security-relevant change.

Today (~line 477):

```ts
if (usedCookie) {
  const sessionId = request.cookies?.[USER_SESSION_ID_COOKIE];
  if (typeof sessionId !== 'string' || !sessionId) throw new UnauthorizedException(...);
  const session = await this.resolveSession(sessionId);
  if (!session || !session.active || session.userId !== userPayload.id) throw ...;
}
```

Proposed: take the session id from the cookie **or** an `X-Session-Id` header,
and require it on both paths.

```ts
const sessionId =
  request.cookies?.[USER_SESSION_ID_COOKIE] ?? request.headers['x-session-id'];
const legacyBearer = !usedCookie && bearerAllowed;   // the signup handover only

if (!legacyBearer) {
  if (typeof sessionId !== 'string' || !sessionId) throw new UnauthorizedException(...);
  const session = await this.resolveSession(sessionId);
  if (!session || !session.active || session.userId !== userPayload.id) throw ...;
}
```

Note what this does **not** change: the ownership check
(`session.userId !== userPayload.id`) and the presence check both stay exactly
as they are, and both now apply to mobile too. The existing
`@AllowBearerToken` routes keep their current exemption and no new route gets
the decorator.

Also in the guard, ~line 400: the `if (!usedCookieToken) { ...refuse... }` block
needs to accept a bearer that carries a valid session id. CSRF stays scoped to
`usedCookie` and is **correct as-is** — a bearer caller is not CSRF-able.

**`src/auth/auth.controller.ts`** — return the tokens in the body for mobile
callers only, keyed off an explicit client header rather than a User-Agent
sniff:

```ts
return {
  user: ..., meta: ..., csrfToken, sessionId,
  ...(isMobileClient(req) && {
    accessToken: result.session.access_token,
    refreshToken: issued.refreshToken,
    expiresIn: result.session.expires_in ?? 3600,
  }),
};
```

Same for `session/refresh` (~line 407), which already calls `sessions.rotate()`
and therefore already does the right thing server-side.

**No Prisma change.** `UserSession` already has everything: `issue`, `rotate`,
`isActive`, `revoke`, `revokeFamily`, `revokeAllForUser`,
`sessionIdForRefreshToken` all exist in `user-session.service.ts`. So CLAUDE.md's
migration rules do not come into play.

**CORS:** production must still allowlist `https://localhost` — see the separate
finding below. That is required for *any* option.

> **Update 2026-09-23:** no longer a release step. `https://localhost` is a
> built-in default (`DEFAULT_NATIVE_APP_ORIGINS` in `app.config.ts`), applied
> whenever `NATIVE_APP_ORIGINS` is unset — which it is in every environment.
> `prod-boot.spec.ts` pins that production's exact variable set allows it.

#### Frontend

| File | Change |
|---|---|
| `src/platform/contracts.ts` | `SecureStorage` already defined. No change. |
| `src/platform/capacitor/secureStorage.js` | **New.** The contract has no implementation yet. Needs a Keychain/Keystore plugin — a new dependency, and the one genuinely new third-party choice in this option. |
| `src/core/api/transport.js` | Attach `X-Session-Id` beside the existing `Authorization` header. The bearer path already exists (line ~356) for the signup handover. |
| `src/platform/web/sessionSource.js` | Unchanged — web keeps cookies. |
| `src/mobile/main.jsx` | Inject the secure-storage-backed session source. |

#### Blast radius on web

**None, by construction.** Web sends no `X-Session-Id` header and keeps using
cookies, so it takes the identical code path it takes today. The guard change is
additive: it widens where a session id may be *read from*, and tightens the
bearer path from "skip the check" to "run the check". No route gains a
decorator. 146 controllers / ~321 route handlers are behind `JwtGuard`, and none
of their behaviour changes for a cookie caller.

The one thing to watch is the `legacyBearer` carve-out: it must stay pinned to
the two signup-handover routes, or it silently becomes the old bypass again.
That deserves a test asserting the decorator appears on exactly those two
handlers and no others.

---

### Option B — `COOKIE_SAME_SITE=none`

One environment variable. No client work. Login starts working immediately.

**What it costs.**

- It is **global**. `sameSite` is read once in `src/config/auth.config.ts` and
  used by both `user-session-cookies.ts` and `admin-auth-cookies.ts`, so the web
  app and the admin app both drop from `Strict` to `None`. The guard's own
  comment calls `SameSite=Strict` "the first line" of CSRF defence; this removes
  it everywhere to fix one client. The `mf_csrf` double-submit remains, so it is
  not undefended — but it is strictly weaker than today.
- It depends on **third-party cookies**, which Chrome is actively phasing out
  and which Android WebView gates behind
  `CookieManager.setAcceptThirdPartyCookies`. A fix that a browser policy change
  can silently undo is not a foundation for a shipped app.
- It does not survive iOS. WKWebView's ITP is more aggressive still, which is
  what test D3 was originally for.

**When it is nonetheless the right call:** if the goal is a working internal
build this week and a store release is months away, this unblocks every
remaining device test (D3, D5, D6, D9 all need a logged-in session) at the cost
of one revert later. It is a legitimate *staging* choice, not a shipping one.

---

### Recommendation

**Option A**, with Option B available as a temporary unblock if device testing
needs to continue before A lands.

A matches the plan already approved (native secure storage was always on the
roadmap), changes nothing for web, and ends with bearer callers *more* checked
than they are today rather than less. Its real cost is a new secure-storage
dependency and a guard change that must be reviewed carefully — which is an
argument for doing it deliberately, not for avoiding it.

If A is chosen, it should be its own branch and its own PR, separate from the
Capacitor wrap, because it touches the authentication guard.

---

### Related finding: production CORS will reject the app

Independent of which option is chosen.

`allowLocalNetwork` in `backend/src/config/app.config.ts` is **forced off in
production**:

```ts
allowLocalNetwork: IS_PRODUCTION ? false : bool('CORS_ALLOW_LOCAL_NETWORK', { default: 'true' }),
```

`https://localhost` — the Capacitor origin — is therefore allowed on dev *only*
because that flag defaults on outside production. Measured against dev:

| Origin | Result |
|---|---|
| `https://localhost` (Capacitor, both platforms after the `iosScheme` fix) | allowed |
| `capacitor://localhost` (old iOS default) | rejected |
| `http://localhost:5173` (dev web) | allowed |
| `https://evil.example.com` | rejected — the allowlist is not a reflector |

**The shipped app would get no CORS at all**, and this surfaces for the first
time at release. Fix: add `https://localhost` to `CORS_ORIGINS` in the
production environment.

> **Update 2026-09-23 — superseded; do not add it by hand.** The origin is now
> allowed by default in code (`DEFAULT_NATIVE_APP_ORIGINS`), so production
> accepts the app as soon as a build containing that code is deployed, with no
> variable to set. Measured on 2026-09-23: the production API, still on a `main`
> build without that code, refuses `https://localhost`; the dev API, on the
> code, accepts it. The one way to break it is setting `NATIVE_APP_ORIGINS` to
> an **empty** value, which means "no app origins".

Worth stating plainly, because it sits against the comment that says a
production API must never treat a developer machine as same-trust: allowlisting
`https://localhost` in production does mean a page served from localhost on
anyone's machine can *make* credentialed requests. What protects the account is
that it still cannot *authenticate* — under Option A it has no token and no
session id, and under cookies it cannot read `mf_csrf` cross-origin. The origin
being allowed is not the origin being trusted. It is still worth a second pair
of eyes before it ships.

---

## Security audit and remediation — 2026-09-09

**Date:** 2026-09-09 · **Scope:** 313 backend endpoints, 66k lines backend, 105k frontend, admin portal, realtime gateway, storage, deployment config, dependencies, git history.

**Result:** 10 commits. Every finding from the audit is fixed, except two that are staged in report-only because they cannot be verified without a browser, and one that needs an infrastructure action rather than code.

**Tests:** backend 2046 passing (144 suites), frontend 1225 passing (115 files). ~90 of these are new and written specifically at the security boundaries below.

---

### Fixed

#### 1. User sessions were unrevocable — **CRITICAL**
`UserSession` model · `auth/session/*` · `jwt.guard.ts` · `supabase.js` · `apiClient.js`

An access token was a pure bearer credential with nothing behind it. Nothing recorded that a device was signed in, so nothing could sign it out. Tokens — **including the refresh token** — sat in `localStorage`, readable by any script on the origin, and a copy lifted from a device kept minting new access tokens until it expired. Logout cleared one browser.

Now: a session row per device; access and refresh in **HttpOnly** cookies (refresh path-scoped so it travels rarely); Supabase's own refresh token moved server-side and **sealed with AES-256-GCM**, so the table is inert to anyone reading the database. Refresh **rotates**, and a token presented twice burns the whole family — the server cannot tell which holder is legitimate, so both sign in again. Device list, "sign out this device", "sign out everywhere". Password change revokes our sessions as well as Supabase's; previously only half the state came down. Tokens left in `localStorage` by earlier versions are purged on load, because changing where new sessions go does nothing about the one already on every existing user's disk.

#### 2. SSRF to cloud metadata — **HIGH**
`link-preview.service.ts`

Mapped IPv6 was screened by a prefix list covering three private ranges. `::ffff:169.254.169.254` — the metadata endpoint — read as public and was fetched; the previewed host serves its own DNS, so it can answer in mapped form. `100.64.0.0/10` was unblocked in both branches (Alibaba's metadata is at `100.100.100.200`). Mapped addresses are now normalised so ranges are defined once. **Verified the 5 payloads passed pre-fix and are blocked after.**

#### 3. Realtime rooms joined without authorization — **HIGH**
`realtime.gateway.ts`

`post:join` and `community:join_room` took the ID from the client and joined unconditionally. The post room carries `comment.created` — **comment body and author** — so any authenticated socket could read comments on posts whose REST route returns 404 for that viewer. Both now apply the same denial set `getPostById` uses and fail closed. **6 of 9 new tests fail against the old handlers.**

#### 4. Conversation attachments were public — **HIGH**
`uploads.service.ts` · `uploads.controller.ts` · `cloudflare-r2.provider.ts`

Chat/voice/message media was served to anyone with the URL — forever, after deletion, unrevocable. Fixed at four layers, because three are individually bypassable: the media route authorizes participation; uploads are born private; signed URLs authorize **participants, not just owners** (ownership alone would have blanked every recipient's images); and objects move to the bucket with no public host — without that last one the rest is decoration, since `cdn.meetifyy.app` resolves any key unauthenticated.

This was only possible *after* the cookie migration: an `<img>` tag cannot send an Authorization header.

#### 5. Vulnerable dependencies — **HIGH**
11 advisories, all but one transitive from **multer 2.2.0**, including a file-size-limit bypass reachable from the upload endpoints. `npm audit fix --force` would have downgraded NestJS four majors; a same-major override fixes the chain. nodemailer 9.0.3 → 9.1.1. **11 → 1** (js-yaml via ESLint, dev-only).

#### 6. Account enumeration — **MEDIUM**
`request-password-reset` returned `exists`. Rate limiting bounds volume, not targeting: one request answered "is this person on Meetifyy?" for any address. Every outcome — missing account, real account, mail failure — now returns `{ sent: true }`. Username/email availability are untouched; a signup form cannot work without them.

#### 7. Smaller findings — **MEDIUM/LOW**
- `unsafe-eval` removed from CSP (verified: no `eval`/`new Function` in 103 built assets; the one `Function("return this")` is the globalThis polyfill behind a short-circuit), `object-src 'none'` added
- Admin OTP was unsalted `sha256` — a million possibilities, trivially reversed from a table dump, on your highest-privilege accounts. Now keyed HMAC, constant-time compare
- Admin CSRF compared with `!==` → constant-time
- Admin bcrypt cost 10 → 12
- `/admin/auth/refresh` was the only unmetered admin auth route
- `OptionalJwtGuard` read `cookies.access_token`, a name nothing ever wrote — cookie-authenticated callers looked anonymous

---

### Staged, not enforced — needs one browser pass

Both ship as `Content-Security-Policy-Report-Only` beside the enforced policy. Browsers evaluate and report; nothing is blocked.

| | Why not enforced |
|---|---|
| **`script-src` without `unsafe-inline`** | Allows each inline script by its sha256. **Updated 2026-09-23:** the version gate now reads the build stamp from a `meetifyy-build` meta tag instead of carrying it, so every inline script is byte-identical across builds and the hashes are a function of `index.html`. `scripts/verify-csp-hashes.mjs` fails the build on a missing hash and `cspReportOnly.test.js` requires an exact match. (The Vite plugin that used to patch the hashes never ran — see [SECURITY.md](SECURITY.md#inline-scripts-must-be-byte-identical-across-builds).) The build no longer transforms the scripts; the "4 → 3, none byte-identical" note is obsolete. |
| **`connect-src` narrowed to named hosts** | Currently allows `http:`/`https:` outright, so CSP cannot constrain exfiltration. Narrowing depends on the full runtime host set; miss one and uploads or sign-in break in production. |

**To finish:** load the app in a browser, exercise login, upload, chat and realtime, and watch the console for CSP violations. Clean → copy the report-only value over the enforced one and delete the report-only header. Tests already pin that the candidate cannot drift weaker than what is enforced.

**Blocker found 2026-09-23 — Cloudflare JavaScript Detections.** Cloudflare injects an inline script at the edge (`window.__CF$cv$params`, then `/cdn-cgi/challenge-platform/scripts/jsd/main.js` from an iframe). Its body carries a per-request ray id and timestamp, so no hash can ever match it. Cloudflare's documented support is a **nonce in the CSP response header**, which it copies onto what it injects; it does not work with hashes or with a `<meta>` CSP, and JS Detections cannot be switched off under Bot Fight Mode. Enforcing `script-src` as it stands blocks that script. Decide first: a per-request nonce (edge middleware, which ends static caching of the HTML), turning JS Detections off (Super Bot Fight Mode only), or accepting that it is blocked. Verified 2026-09-23: with the report-only value served as the **enforced** policy, `/`, `/login`, `/signup` and `/home` all boot with zero violations — the Cloudflare script is absent locally.

---

### Needs an infrastructure action

**Chat media uploaded before commit `bc60f39` is already on the public CDN** and stays reachable by URL. New uploads go to the private bucket; old objects do not move themselves. Closing it means copying those objects into the private bucket and repointing their `media` rows, or removing the bucket's public host.

**Also:** confirm the old Supabase project `aqeivtmrdyabfaddpjon` is deleted. Its anon key is in git history (commit `6f117e2`, removed in `770c257`). An anon key is public by design and it is not the current project, so this is low severity — but a live project behind it with weak RLS would not be.

---

### Verified clean

SQL injection (every raw query is a static literal) · mass assignment (`whitelist` + `forbidNonWhitelisted` globally) · path traversal (regex plus an independent containment check) · dev endpoints (constructor throw, env gate, token-or-loopback, constant-time, ignores proxy headers) · socket handshake (rate limited *before* verification, plus a DB lifecycle check because sockets bypass `JwtGuard`) · conversation rooms (verify participation) · error handling (generic 5xx, stacks server-side, 12 redacted field names) · secrets (only `.example` tracked; no service-role key in the frontend) · admin auth (per-IP *and* per-account limits, 5-attempt OTP lockout, CSRF double-submit, HttpOnly, revocation) · headers (`frame-ancestors 'none'`, `base-uri`, `form-action`, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`).

**Endpoint inventory:** 313 — 194 user-JWT, 87 admin, 1 optional, 31 public (all legitimately).

---

### What was not tested

**No live attack testing.** Manipulated JWTs against a running server, cross-user IDOR probing with real accounts, socket events from a real client, guessed media URLs, CSP enforcement in a browser — none performed; browser and session access were blocked in this session.

Everything above is static analysis plus tests at the security boundary. Where a fix closed an attack, I demonstrated the pre-fix code accepting the attack input and the post-fix code rejecting it. That is a real boundary test. It is not an authenticated end-to-end probe.

**The largest remaining gap: ownership checks across the 194 authenticated endpoints were reviewed by reading, not by probing.** A staging IDOR sweep is the highest-value next step.

**One flaky suite:** `src/share/share.routes.spec.ts` intermittently times out under full-suite parallel load (~65s). Passes alone, references neither `JwtGuard` nor cookies, renders images. Pre-existing, unrelated to this work — but worth a timeout bump so it stops masking real failures.

---

### Deployment notes

1. `SESSION_SECRET` should be set explicitly. It falls back to the service-role key, so no environment silently stores provider tokens unprotected — but rotating it invalidates every session, signing everyone out.
2. A migration is pending: `00000000000008_user_sessions`.
3. `R2_VERIFICATION_BUCKET_NAME` now also carries conversation media. If it is unset, those objects fall back to the main (public) bucket and layer 4 of finding 4 is inactive.
4. The bearer-token path in `JwtGuard` is deliberately still accepted, so clients holding pre-cookie tokens are not signed out on deploy. Remove it once traffic has moved over.

---

## Android performance audit — 2026-10-05

Date: 2026-10-05 · Branch: `development` · Device: Vivo I2208 (Snapdragon 4 Gen 1,
6 GB, Android 14) running the installed debug APK against the **dev** API
(`dev-api.meetifyy.app`).

Method: six focused static audits (Capacitor/Android, React rendering,
API/backend, media/network, startup/navigation, memory/CPU/scroll) plus
on-device measurement over the Chrome DevTools Protocol (`adb forward` to the
WebView's devtools socket, reading Navigation/Resource Timing and the app's own
`performance.mark`s), and `am start` + the debug-only `MeetifyyLaunch` log line
for the splash.

Every finding states whether it was **measured** on the device, **confirmed**
by reading the code, or is a **hypothesis** still needing a trace.

---

### Baseline measurements

#### Cold start (signed in, 4 runs, page timeline from navigation start)

| Phase | Measured |
|---|---|
| Launch intent → WebView navigation start | 750–820 ms |
| navStart → DOMContentLoaded (parse/eval ~910 KB JS) | 520–800 ms |
| `POST /api/auth/session/refresh` | **1,312–2,427 ms** |
| `GET /api/auth/session` — starts only after refresh | 238–949 ms |
| `meetifyy:auth-decided` mark | 2,475–4,319 ms |
| Splash released (from intent) | **3.6–5.8 s**; in 2 of 7 runs by the 5 s *backstop*, not readiness |

About 55% of cold start is the two auth round trips, which run one after the
other.

#### Home boot network (one run)

19 API/XHR requests in the first 3.6 s. They include `/api/app/version`,
`/api/legal/documents`, `/api/instant-match/state`, `/api/communities/mine`,
`/api/communities`, `/api/users?limit=20` (434 ms), `/api/media/signed-urls`,
and **7 Socket.IO long-polling XHRs** before the WebSocket upgrade.

#### Bundle (mobile build)

| Asset | Size (raw) | On startup path |
|---|---|---|
| `index.mobile-*.js` (entry) | 550 KB | yes |
| `vendor-react` | 283 KB | yes (modulepreload) |
| `vendor-icons` | 78 KB | yes (modulepreload) |
| `index-*.css` | 301 KB | yes, render-blocking |
| `ReportModal` (zod + react-hook-form) | 100 KB | yes, statically imported by `Post` |
| `browser-image-compression` (in `mediaPipeline`) | ~52 KB | yes, via `PostComposer`/`ShareSheet` |
| `proxy-*.js` (framer-motion) | 128 KB | no, only signed-out public-post/404/Help |
| `native-*.json` (emoji-mart data) | 433 KB | no, fetched only when the picker opens |

APK: 9.4 MB debug / 6.5 MB release; `classes.dex` is 38% of release, and R8 is off.

---

### Critical

#### C1. Cold start waits on two serial auth round trips
- **Evidence (measured):** refresh 1.3–2.4 s, then `/session` 0.24–0.95 s, strictly serial; splash backstop fires.
- **Root cause:** the native access token is kept in memory only (a deliberate security choice, `platform/capacitor/sessionSource.js`), so every launch must refresh first. The refresh response did not say *who* the session belongs to, so `GET /api/auth/session` had to follow it. Server side, the refresh is itself serial: Redis rate limit → 3 DB round trips in `rotate` → Supabase HTTPS refresh → 1 DB write (`auth.controller.ts` `refreshSession`, `user-session.service.ts` `rotate`). On dev the API (UAE North) and DB (Singapore) are in different regions, so each DB trip costs ~100 ms.
- **Fix:** the refresh optionally (`includeProfile: true`) loads the profile *concurrently* with the Supabase call and returns it; the transport answers the boot probe from it. This is additive: older apps ignore the field, and a new app against an older API falls back to the GET.
- **Not done (needs your decision):** persisting the access token in Keystore would skip the refresh entirely within its 1 h lifetime, but contradicts the documented "fewer copies of a secret" design.
- **Risk:** auth path; §9b invariants checked (profile only returned after the provider refresh succeeds; failures omit the field).

#### C2. ~910 KB of JS must be parsed before the first network request can start
- **Evidence (measured DCL 520–800 ms; confirmed by sourcemap):** `@supabase/auth-js` 98 KB is in the entry although mobile only needs it for signup `verifyOtp`. `ReportModal` 100 KB and the image compressor 52 KB are on the Home path but used only on tap/upload. The render-blocking CSS carries about 90 KB of page stylesheets imported by eager skeletons.
- **Fix:** lazy-load `ReportModal` and the compressor (done); auth-js and skeleton-CSS splitting are documented as next steps.
- **Hypothesis (unverified):** Capacitor serves assets via `shouldInterceptRequest`, which may prevent V8 code caching, so every launch recompiles. Not confirmed from an authoritative source, and needs a trace.

---

### High

#### H1. Every feed image downloads twice, starting with the full-size original
- **Confirmed:** post media `url` is `/api/media/<key>` (`backend/src/posts/post-view.ts:77`). That is a 302 to the 1920 px original, rendered first. Then a batched `POST /api/media/signed-urls` swaps it for the 1080 px `_thumb.webp` (`MediaGrid.jsx:434-537`).
- **Cost:** about one original (150–500 KB) wasted per image, plus a redirect hop and the boot-time `/signed-urls` call.
- **Fix:** server returns the public thumbnail URL with the post, for public keys only.

#### H2. Avatars load 512 px originals into 32–48 px slots
- **Confirmed:** `Avatar` takes `thumbnail` as an opt-in; only 1 of 52 call sites passes it, though a 160 px thumb is uploaded for every avatar.
- **Fix:** default to the thumbnail for small sizes, falling back to the original on error.

#### H3. Presence and conversation events re-render every post body and chat bubble
- **Confirmed:** `handlePresenceUpdate` (`SocketManager.jsx:309,392,407`) maps to a new array even when nothing matched. That rebuilds `UsersMapProvider`'s value at the app root, and every `RichText` (each Post, Comment, Message) plus `MessageBubble` consumes it, bypassing `memo`.
- **Fix:** return the same array when unchanged; give the users map a stable identity per entry.

#### H4. No pause/resume handling
- **Confirmed:** `AppLifecycle` exists only as an interface. Nothing subscribes. `mobile/main.jsx` disables `refetchOnWindowFocus` claiming resume is handled elsewhere, but it isn't. The socket heartbeat (25 s) keeps running in the background, data is never refreshed on resume, and the socket gives up after 15 attempts (~2 min) and is never reconnected.
- **Fix:** on `visibilitychange`, pause the heartbeat while hidden; on resume, reconnect a dead socket and refetch stale active queries.

#### H5. Socket.IO always starts with HTTP long-polling
- **Measured:** 7 polling XHRs per boot. Config is `['polling','websocket']` (`useGlobalSocketStore.js:96`), deliberate for filtered campus networks.
- **Fix:** Socket.IO's documented WebSocket-first form, `transports: ['websocket','polling']` + `tryAllTransports: true`, keeps the polling fallback.

#### H6. Opaque bottom nav runs a full-width backdrop blur on every scroll frame
- **Confirmed:** `BottomNav.module.css` uses `backdrop-filter: blur(20px) saturate(180%)` over a solid `#fff`/`#000` background, so the blur is invisible but still computed.
- **Fix:** remove it.

#### H7. Feed videos never use their uploaded posters
- **Confirmed:** the feed query selects no poster (`posts.service.ts:857`), so each rendered video, off-screen included, mounts `<video preload="metadata">`. Phone MP4s with a trailing `moov` box can pull MBs.
- **Fix:** poster-first (needs a backend select plus a `MediaGrid` change). Documented, not done.

#### H8. Conversation-list Redis cache is never invalidated
- **Confirmed:** written as `user:conversations:v2:…` but invalidated as `user:conversations:…` (`messages.service.ts:270`, `users.service.ts:2046`, `group-chats.service.ts:88`). A refetch after sending can be served a list up to 60 s stale, which overwrites correct client state.
- **Fix:** one key prefix for both.

---

### Medium

- **M1. Pull-to-refresh registers a non-passive `touchmove` for as long as Feed/Messages/Notifications/Community are mounted** (`usePullToRefresh.js:271`). Every scroll's first move waits on the main thread. Fix: attach the blocking listener only once a pull can start.
- **M2. Feed video progress rAF writes `textContent` every frame** (`MediaGrid.jsx:66-93`, `VideoViewer.jsx:235-283`). Each write is a DOM mutation that also wakes the system-bar sampler's `MutationObserver`. Fix: write only when the displayed second changes.
- **M3. System-bar sampler reruns on every `#root` mutation, including virtualized feed scroll** (`installSystemBars.js:435`). Each sample does `elementsFromPoint` and `getComputedStyle`.
- **M4. A synchronous `SharedPreferences.commit()` runs on the UI thread at every launch**, even when nothing changed (`SystemUiPlugin.java:75-91`).
- **M5. Comment replies query has no `postId` and `parentId` is unindexed** (`posts.service.ts:1915`). This is a full `Comment` scan per depth level.
- **M6. Web GETs send `Content-Type: application/json`**, which makes every cross-origin GET preflighted (`transport.js`).
- **M7. `useGlobalSocketStore()` is read without selectors** in PostView, CommunityView, MessagesRoute and others, so every reconnect re-renders those subtrees.
- **M8. `.msgHoverActions { will-change: opacity }` on every chat message**, including on touch devices where hover never fires. That is one compositor layer per message.
- **M9. Create Activity / Activity Detail stack 10+ `backdrop-filter` blurs** over a blurred, `will-change`-promoted full-screen background. Design sign-off needed.
- **M10. Chat thread is not virtualized** and grows without bound as older pages load.
- **M11. Session payload embeds unbounded follower/following username lists and every bookmark id** (`auth.service.ts:425-450`). Installed apps read it, so changing it needs a release cycle.
- **M12. Version check and legal check fire on every resume** (`UpdateGate.jsx:86`).
- **M13. R8 is off for release; about 1 MB of unused template `splash.png`s ship.**

### Low

- Shimmer skeletons animate `background-position` (paint every frame); several `box-shadow` pulse animations.
- Unbounded module-level URL Sets (`MessageBubble.loadedImageUrls`, `Avatar`, `imageWarmup`) and `MediaCacheManager` never evicting expired entries.
- `GET /api/users?limit=20` on Home boot (434 ms) feeds a users map with the 20 newest signups, which is not useful for mentions.
- `JwtGuard` runs session, account and legal lookups serially on a cache miss.
- Idle route prefetch misses PostDetail, SearchResults, ActivityDetail and CreateActivity.
- Logo `meetify_logo.webp` is 1024² shown at 28 px.

### Checked and fine

The feed is window-virtualized with memoized posts. Notifications are virtualized. Socket listeners are balanced (on/off). The system-bar bridge calls are deduped (0 per scroll). Only three Capacitor plugins are used. No service worker in the app. The emoji data and framer-motion stay off the startup path. Gzip is on. Refresh is single-flight. The feed request starts in parallel with the session probe. Indexes cover feed, notifications and messages. Upload pipeline converts to WebP with thumbnails, and verification media stays private.

---

## Android performance work — 2026-10-05

Date: 2026-10-05 · Branch: `development` (uncommitted at the time) · Findings and baseline:
[the audit above](#android-performance-audit--2026-10-05)

Test device: Vivo I2208 (Snapdragon 4 Gen 1, 6 GB, Android 14), debug APK built
from this tree, against the deployed **dev** API. Measurement used the Chrome
DevTools Protocol against the app's WebView, `am start`, the debug `MeetifyyLaunch`
log, and `dumpsys gfxinfo`.

### How it was investigated

1. Six focused audits ran in parallel: Capacitor/Android, React rendering, API/backend, media/network, startup/navigation, and memory/CPU/scroll.
2. On-device baselines were taken before any change: cold start ×7, boot network waterfall, resume behaviour, and image requests.
3. External research covered three questions:
   - Socket.IO transport order (`tryAllTransports`);
   - passive vs non-passive touch listeners in Chrome;
   - whether Android WebView code-caches Capacitor's intercepted responses. This one stayed unresolved, so nothing was changed on its basis.
4. Each fix was verified on the device where it could be observed. One change was reverted when its premise turned out to be false (see "Tried and reverted").

### Results (measured)

| What | Before | After | Notes |
|---|---|---|---|
| Bottom-nav scroll, frame time p90 (gfxinfo, 3×A/B, same build) | 24–28 ms | **18–20 ms** | Invisible `backdrop-filter` removed |
| Bottom-nav scroll, GPU time p50 / p90 | 8–9 / 9 ms | **6 / 6–7 ms** | about 30% less GPU work per frame |
| Feed post whose thumbnail does not exist | 780–1,036 ms uncacheable 404 on **every** mount and launch | paid once, then skipped for 24 h | measured from a clean state over two launches |
| Data refreshed when returning to the app | **nothing** | stale screens refetch (feed excluded) | `visibilitychange` verified to fire in the WebView |
| `mediaPipeline` chunk on the Home path | 62.9 KB | 9.9 KB | compressor (53 KB) loads on first upload |
| `ReportModal` (zod + react-hook-form) on the Home path | 100 KB parsed at boot | not loaded until a report is opened | 1 KB wrapper instead |
| Cold start, splash released (4 runs each) | 3.6–5.8 s, backstop fired in 2/7 | 3.6–3.9 s, backstop 0/4 | **Not attributable to these changes:** the refresh endpoint itself was faster in the second hour (1.1–1.6 s vs 1.3–2.4 s). Network variance dominates. |

#### Not yet measurable on the device

The largest startup fix, removing the serial `GET /api/auth/session` after the
refresh, needs the backend change deployed to dev (CI on merge). The device
currently runs the new app against the old API. That proves the
**backward-compatible fallback** works: still signed in, same two calls. The
expected saving is the measured duration of that second call, **206–949 ms per
cold start**. Confirm after deploy by re-running the cold-start series:
`/session/refresh` should be the only auth request.

### Fixes implemented

#### Startup / auth (backend + frontend)
- **Refresh can return the profile.** `POST /api/auth/session/refresh` with
  `includeProfile: true` runs `syncProfile` *concurrently* with the Supabase
  refresh, and returns `user`/`meta` only once that refresh has succeeded. Any
  failure omits the field, so the client falls back to `GET /api/auth/session`,
  which reports errors exactly as before. Ordinary mid-session renewals don't ask
  for the profile, so they are byte-identical.
  (`backend/src/auth/auth.controller.ts`)
- **The transport answers the boot probe from it.** The cold-start renewal asks
  for the profile. The next `GET /api/auth/session` is served from the response
  once, within 15 s, and only while the stored refresh token is still the one it
  arrived with. Any sign-out (which clears it) or new sign-in (which replaces it)
  makes it unusable, whichever code path ran.
  (`frontend/src/core/api/transport.js`)
- **Compatibility:** additive in both directions. Old installed apps ignore the
  field, and a new app against an old API makes the GET as before (verified on
  the device).

#### Bundle
- `ReportModal` is lazy-loaded through `LazyReportModal` at all seven call sites.
- `browser-image-compression` is dynamically imported on first upload.

#### Rendering / scroll
- Removed the bottom nav's `backdrop-filter`: its background is opaque in both themes, so the blur was invisible but computed every frame.
- Removed `will-change: opacity` from every chat message's hover actions (one compositor layer per bubble).
- **Users map keeps its identity** unless a user in it actually changes. It is read by every `RichText` and `MessageBubble`, and was rebuilt on every message preview or unread update. That re-rendered every post body and chat bubble on screen per incoming message.
  - Correction to one audit: TanStack's structural sharing already made a no-op presence update free; the cost was in the map, not the presence handler.
- Video progress loops replace the timer text only when the second changes, instead of every frame. Each write was a DOM mutation that also woke the system-bar sampler.

#### Network / media
- **Missing-thumbnail memory** (`shared/utils/missingThumbnails.js`): a thumbnail key is skipped for 24 h, persisted and bounded. It is recorded only once the original has loaded after the thumbnail failed, so being offline or a 5xx never marks it.
- **Small avatars use the 160 px thumbnail by default** (fixed size ≤ 48 px, which stays sharp at 3x). Previously 1 of ~50 call sites opted in. Verified on the dev API that `/api/media/<key>_thumb.webp` falls back to the original, unauthenticated, when no thumbnail exists, so this can only save bytes.

#### Lifecycle / realtime
- **Refresh on resume:** `refetchOnWindowFocus` was off, on the premise that a WebView never fires focus. It does fire `visibilitychange` (measured), and the replacement `AppLifecycle.onResume` was never implemented. Now on, except for infinite lists (feed, community posts, chat history…). A resume refetch would re-request every loaded page and reorder the list. Those lists have pull-to-refresh and socket updates.
- **Socket revival:** after Socket.IO exhausts its 15 reconnect attempts (~2 min), the next resume or `online` event reconnects it once. It deliberately does not redial a socket the server disconnected (refused or revoked session).

- Socket-store readers (SocketManager, PostView, CommunityView, chat hooks) select single fields instead of the whole store, so a reconnect no longer re-renders those subtrees.

#### Backend correctness / query cost
- **Conversation-list cache was never invalidated.** Entries are written under `user:conversations:v2:…`, but all three evictors used v1-shaped keys. A send, block or account deletion left lists stale for the full TTL. All four sites now share one key builder (`messages/conversation-list-cache.ts`) and evict with a direct `DEL` of the first pages clients refetch, rather than a keyspace `SCAN`.
- **Comment replies:** added `postId` to the per-depth reply query. `parentId` has no index, so each level scanned the `Comment` table; now it uses `(postId, createdAt)`. No migration.

#### Android
- `SystemUiPlugin.setColors` skips the synchronous `SharedPreferences.commit()` when nothing changed, which is the common case at every launch.
- Deleted 11 unused Capacitor-template `splash.png` files (844 KB, unreferenced; the splash uses `meetifyy_splash_logo`).

### Final review (independent subagent, PR-style)

No blocking issues. Every finding was fixed:

| Finding | Fix |
|---|---|
| Thumbnail marked missing on *any* error (offline, 5xx) | Marked only after the original loads |
| Avatar cut-off 96 px too high for a 160 px thumb at 3x | Lowered to 48 px |
| Boot profile not cleared by the real sign-out path | Bound to the refresh token it arrived with; test drives `session.forget` and an account switch |
| Other infinite lists refetched every page on resume | All infinite queries excluded |
| Group-chat eviction scanned the keyspace twice per user | Direct `DEL`, matching the other evictors |
| CRLF → LF churn in `mediaPipeline.js` (and, found while checking, `PostView.jsx`, `useTypingIndicator.js`) | Original line endings restored |
| Untyped `jest.Mock`s in the new spec | Typed to the real signatures (which caught a wrong `meta` shape) |

Accepted as-is, and noted:
- When an account must accept updated policies, the legal-acknowledgement gate now rises on the first gated request after boot rather than on the boot probe. No data is exposed: it is the caller's own profile, which `login` already returns.
- Legacy replies whose parent is on another post are no longer listed. They could never render correctly anyway.

### Tried and reverted
- **`hasThumb` in the feed payload.** The idea was for the server to say which thumbnails exist (via the unique `objectKey` index). A read-only check on dev showed the database has a thumbnail row for posts whose thumbnail object **does not exist in R2**: rows are registered at presign time. The flag would have been wrong, so it was removed.

### Decided against, with reasons
- **Socket.IO WebSocket-first:** the code documents a measured reason for polling-first. Intercepting campus proxies hang WebSocket attempts for the full timeout. The polling XHRs start after auth and don't block UI.
- **Pull-to-refresh lazily attaching its non-passive `touchmove`:** Chrome derives blocking from the event-handler region, which updates on commit. A listener added during `touchstart` risks non-cancelable moves and a broken pull gesture. Needs a device trace before changing.
- **R8 / `shrinkResources` for release:** worthwhile (`classes.dex` is 38% of the release APK) but needs an on-device release smoke test. Installing a release-signed APK would remove the debug install and its sign-in.
- **Persisting the access token** to skip the cold-start refresh entirely: contradicts the documented "fewer copies of a secret" design. That's the owner's decision.

### Remaining bottlenecks and recommended next steps (by expected impact)

1. **Thumbnail uploads appear to fail silently** (high impact on bandwidth). On dev, the sampled posts have a `_thumb` DB row and no R2 object, and `mediaPipeline` swallows every variant-upload error. So the feed effectively downloads originals at 1920 px. Reproduce one upload with logging, and check production with a read-only request.
2. **Server refresh path:** fold `rotate`'s three DB round trips into one statement, and run `JwtGuard`'s session/account/legal lookups concurrently. Dev pays ~100 ms per DB trip (API UAE North ↔ DB Singapore); co-locating dev would also help.
3. **Entry chunk:** `@supabase/auth-js` (98 KB) is only needed for signup on mobile; skeletons import whole page stylesheets into the 301 KB render-blocking CSS.
4. **Create Activity / Activity Detail:** 10+ stacked `backdrop-filter`s. The gfxinfo A/B above shows what one full-width blur costs on this phone. Needs a design decision.
5. **Feed videos:** use the uploaded poster, and create `<video>` only on play.
6. **Chat thread:** not virtualized; at least `content-visibility: auto` on rows.
7. **Pause handling:** the 25 s presence heartbeat runs in the background.
8. **Session payload:** unbounded follower/following/bookmark arrays, which installed apps read, so it needs a release cycle.
9. Smaller items are listed in the audit above (Medium/Low).

### Verification
- Backend: 2,527 tests pass (one fewer than mid-session: a helper removed after review took its test with it); `npm run lint` (blocking, zero warnings) clean.
- Frontend: 208 files / 1,991 tests pass; `npm run typecheck` and `npx eslint .` clean; perf suite 3/3.
- Device: final debug APK built and installed (`adb install -r`, data kept). On the phone:
  - signed-in cold start; Home, Messages, a chat thread with media, Notifications, Communities, Crew, Settings and Profile render with no console errors;
  - resume refetch, thumbnail memory and the gfxinfo A/B were exercised as described.
- Not tested on the device: Create Activity, theme switching, slow-network emulation, and the APK against an API carrying the backend change.

---

### Round 2 (2026-10-05, later): launch flicker and slow reopen

Researched how feed apps open fast:
- Android's guidance is to hold the splash for local data only, never a network call.
- X shows the last timeline from disk and refreshes it.
- Instagram cut work off the cold-start path.
- Reddit gained 50%+ from R8 and Baseline Profiles.

Measured frame by frame (`screenrecord` + per-frame analysis) on the I2208.

**Before:** the splash logo stayed up **4.5–5.4 s** (3 recorded launches) waiting
for two network calls. It then cross-faded over 180–250 ms *on top of* the
painted feed, leaving a half-transparent logo over the posts. That is the flicker.

**Changes:**
- **Local-first boot, installed app only** (`AuthContext.jsx`). With a Keystore
  refresh token and a saved profile, the app opens on that account immediately
  and verifies with the server behind it.
  - A refusal tears down everything (`clearLocalSession`).
  - Offline keeps the cached account, as `settleUnknown` already did.
  - 5 tests in `authLocalFirstBoot.test.jsx`.
- **Feed snapshot** (`mobile/feedSnapshot.js`). The first Home page (≤12 posts)
  is saved after each real fetch and restored before the first render, as
  stale data, so it refetches.
  - Scoped to the user id, and in `SESSION_SCOPED_KEYS`, so every exit clears it.
  - At most 3 days old.
- **Hand-off** (`MainActivity.fadeSplashOut`). The logo is hidden at once and
  only the background fades, over 150 ms (was 280 ms, whole view).

**After:**
- Clean launches (2 recorded): logo → one ~30 ms black frame → page. No ghost
  logo, and no logo after the page appears.
- One signed-in launch with a cached feed: Home painted **~2.5 s after the
  logo**, against 4.5–5.4 s before.
- A launch on a process Vivo had **pre-started** (`preStart_up`) showed
  logo → bare shell → logo → page. Not yet reproduced or explained; it needs a
  signed-in session to investigate.

#### Found: launches can sign the user out (pre-existing, serious)
Every cold start rotates the refresh token, because the access token is kept in
memory only. If the process dies between the server rotating the token and the
app writing the new one to the Keystore, the next launch presents the old token.
The server treats that as theft (`session.refresh_replay`) and revokes the whole
family. Observed on the dev API at 11:08:28Z after a launch was killed ~270 ms
after its refresh.

On this Vivo phone the OS **pre-starts the app in the background**
(`am_proc_start … preStart_up`) and removes tasks from the launcher. So a
rotation can happen with nobody looking, and be cut off.

Industry practice: Supabase's own auth server accepts the *immediately previous*
refresh token for 10 s and returns the same successor; Auth0 has a "rotation
overlap period". Options for the owner:
1. A short reuse window on `/session/refresh` for the immediate parent token
   only. It covers a quick reopen.
2. Keep the access token (1 h) in the Keystore beside the refresh token. Most
   launches then skip the rotation entirely, which is faster and cuts the number
   of risky rotations by about 60× for a user who opens the app every minute.
   It contradicts the current "fewer copies of a secret" design.
3. Both.

#### Also found
Debug builds' Capacitor bridge logs secure-storage results, including the
refresh token, to **logcat**. Consider `"loggingBehavior": "none"` in
`capacitor.config.json`; release builds already don't log.

---

### Round 3 (2026-10-05): the remaining items, researched before fixing

Every item was re-checked against the code, then against external guidance,
before changing anything. Two audit claims turned out to be wrong or
incomplete, and are corrected below.

#### 1. Surprise sign-outs (refresh-token rotation race) — fixed
- **Guidance:**
  - RFC 9700 §4.14 requires reuse detection for public clients.
  - Supabase (10 s reuse interval), Auth0 (rotation overlap) and published
    RFC 9700 implementations add a short grace window with single-successor
    semantics, because a lost response is indistinguishable from theft.
  - Mobile apps must avoid rotating from killable background states.
- **Server** (`user-session.service.ts`):
  - **Lost-rotation recovery.** The old token is accepted again only if it is
    the *immediate* parent of the live token, and that successor was **never
    rotated, revoked or used**, and is **under 60 s old**. When accepted, the
    unused successor is revoked and a new one is minted from the parent,
    carrying the newest provider token.
  - **Atomic rotation:** a conditional `updateMany` means two concurrent
    refreshes can never both mint a successor.
  - **Stricter than a plain reuse interval:** an attacker using the old token
    inside the window gets a session that is revoked as soon as the real app
    returns, because its next refresh finds a *used* successor.
- **"Used" signal** (`JwtGuard.markSessionUsed`): stamps `lastActiveAt` on a
  session's first use, then at most once a minute. It was never written after
  sign-in before, so the device list's "last active" is now accurate too.
  Verified read-only on dev that untouched rows have
  `lastActiveAt = createdAt` (45/45).
- **Client:** the launch-time renewal waits until the app is visible
  (`whenForeground`). Vivo's background `preStart_up` no longer rotates tokens
  in a process the OS may kill.
- **Tests:** recovery, theft after use, grace expiry, older ancestor,
  first-use stamping, the foreground gate, and a burst of requests renewing
  once.

#### 2. Access token kept on the device — done, per OWASP
- **Guidance:** OWASP MASVS-STORAGE (Keystore-backed encryption) and AppAuth,
  which persists its whole auth state.
- The secure-storage plugin is AES-GCM under an Android Keystore key, which
  meets that bar.
- The access token is stored with its expiry (from its own `exp` claim), and is
  used at launch only with more than 2 minutes left. A token with no knowable
  expiry is never written.
- There is no added exposure: the 30-day refresh token beside it is strictly
  more powerful, and the access token is session-bound, so revoking the device
  still ends it. Launches within the hour no longer rotate at all.
- **Found and fixed:** Android Auto Backup was copying the credential file
  (ciphertext, unreadable after restore) to Google Drive and to new phones.
  `backup_rules.xml` (Android ≤ 11) and `data_extraction_rules.xml` (12+) now
  exclude `WSSecureStorageSharedPreferences.xml` only. Both are required,
  because each Android version reads only one of them.

#### 3. Tokens in logcat — done
- `"loggingBehavior": "none"`. Capacitor's docs warn its logging "can leak
  information on device".
- The default (`debug`) already logged nothing in release builds. Our own
  `MeetifyyLaunch` log is unaffected. Console output remains available over
  `chrome://inspect`.

#### 4. Thumbnails missing — root cause found: **every** direct upload fails
- On dev, each upload left four rows: a presigned original (PUT failed), the
  server pass-through original (used by the post), a presigned `_thumb` (PUT
  failed), and a pass-through thumbnail **at a random key** (orphaned).
- A CORS preflight to the R2 bucket returns **403 for every app origin**, so the
  bucket has no CORS policy.
- **Code fixes:**
  - The pass-through keeps a thumbnail's derived key.
  - After one network/CORS failure, the session goes straight to the
    pass-through (no doomed presign).
  - The presign returns the headers it signed (`Cache-Control` differs for
    identity documents, so the client's hard-coded public value would have
    broken their signature).
- **Security hole fixed before it could open:** any signed-in user could
  presign someone else's `<key>_thumb.webp` and replace their feed thumbnail,
  taking over the Media row via the upsert. Now a variant may only be written
  by the owner of its original, and only over a variant row they own (6 tests).
  It was inert only because every direct upload failed.
- **You need to apply** a CORS policy on each bucket (Cloudflare dashboard →
  R2 → bucket → Settings → CORS, or
  `npx wrangler r2 bucket cors set <bucket> --file cors.json`). The API's R2
  key has no bucket-admin rights. Exact origins, never a pattern (CLAUDE.md §2):

  Development bucket(s) — main and the private/verification bucket:
  ```json
  [{ "AllowedOrigins": ["https://dev.meetifyy.app", "https://dev-admin.meetifyy.app", "https://localhost", "http://localhost:3000", "http://localhost:3001"],
     "AllowedMethods": ["PUT"], "AllowedHeaders": ["Content-Type", "Cache-Control"],
     "ExposeHeaders": ["ETag"], "MaxAgeSeconds": 3600 }]
  ```
  Production bucket(s):
  ```json
  [{ "AllowedOrigins": ["https://meetifyy.app", "https://www.meetifyy.app", "https://localhost"],
     "AllowedMethods": ["PUT"], "AllowedHeaders": ["Content-Type", "Cache-Control"],
     "ExposeHeaders": ["ETag"], "MaxAgeSeconds": 3600 }]
  ```
  Add the admin origin only if the admin uploads directly. Verify with the
  preflight in [INFRASTRUCTURE.md](INFRASTRUCTURE.md#storage-r2), against
  `https://<account>.r2.cloudflarestorage.com/<bucket>/x`.

#### 5. Background work — fixed (app only)
- Capacitor's `KeepRunning` defaults to true, so the WebView was never paused
  (verified in its source). The socket and the 25 s presence heartbeat ran until
  Android froze the process.
- Now, after **30 s hidden**, the socket disconnects cleanly. Short trips to
  the photo picker or a share sheet are unaffected. On return it reconnects and
  re-syncs.
- The website is unchanged: a background tab is a normal way to use it.
- Not `KeepRunning=false`: that pauses every JS timer app-wide, which is riskier
  for in-flight uploads.

#### 6. Feed videos — fixed, per web.dev
- **Guidance:** web.dev's lazy-loading video article — poster plus
  `preload="none"`, upgraded via IntersectionObserver.
- Idle tiles now show the uploaded `_thumb.webp` poster.
- The first-frame `<video>` fallback mounts only within a screen of the
  viewport. The virtualized feed keeps off-screen posts mounted, and each one
  fetched video metadata.
- **Bug fixed:** multi-item grids rendered a video tile as `<img src={mp4}>`,
  which always errored and retried.

#### 7. Chat thread — deliberately not changed
- `content-visibility: auto` on reverse-anchored chat lists causes scroll
  jitter: messages above the fold are never rendered, so they keep placeholder
  heights. Projects have removed it from chat for this reason.
- The safe wins are already in (no per-bubble `will-change`, no re-render storm).
- Real virtualization needs dedicated on-device testing of the scroll anchoring.

#### 8. Guard lookups — parallel
- `JwtGuard` now *starts* the account-status and legal lookups beside the
  session lookup, which saves two serial DB round trips on a cold cache.
- The checks are still *judged* in the same order: a revoked session is always
  401 "signed out", never a suspension. A test pins the precedence and the
  overlap.

#### 9. Startup bundle — `@supabase/auth-js` out of the entry
- The package declares no `sideEffects`, so it cannot be tree-shaken. The
  mobile build aliases `@shared/lib/supabase` to `src/mobile/supabaseFacade.js`
  (same exports; loads on first use; `onAuthStateChange` keeps its synchronous
  contract).
- **Entry chunk: 550,898 → 453,897 bytes (−97 KB, −17.6%).** The website build
  is unchanged.
- Skeleton page-CSS splitting was left: visual-regression risk for a smaller gain.

#### 10. Create Activity / Activity Detail blurs — reduced on touch devices
- **Guidance:** CSS Filter Effects 2 — an element with `backdrop-filter` is a
  *Backdrop Root*, so nested backdrop filters only see the card's own fill.
- **Activity Detail:** the five blurs nested inside `.glass` were invisible at
  full GPU cost, plus a permanent `will-change: backdrop-filter`. Removed on
  `(pointer: coarse)`.
- **Create Activity:** the form fields blurred a background that is already a
  48–64 px blur. Removed on phones. Kept where the blur is visible: small
  controls over the sharp cover image, dropdowns, modals.
- Desktop keeps all of them.

#### Session payload (unbounded follower/bookmark arrays) — plan, not changed
Installed apps read these fields, so removing them needs the version gate:
1. Ship clients that read counts and fetch lists on demand.
2. Raise the minimum version.
3. Then drop the arrays.

#### Verification
- Backend: 2,542 tests; lint (blocking) and typecheck clean.
- Frontend: 2,013 tests; typecheck, ESLint and perf clean.
- Mobile bundle verified by an out-of-tree build.
- **Not yet verified on the device** (it disconnected mid-round): the persisted
  access token skipping the rotation on a second launch, logcat silence, the
  socket release after 30 s, and the blur and video changes on screen.
- The server-side recovery and parallel guard need a deploy to dev before they
  can be seen end to end.
