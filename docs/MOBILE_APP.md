# The installed app (Capacitor)

The Android app is the **real website** — same `App`, providers, routes and
screens — built a second time into a Capacitor 8 WebView. This document covers
what differs, how it is built and tested on a device, and the measured state of
its startup and performance.

The binding rules for changing mobile code (the frozen-copy problem, the
version gate, `IS_MOBILE_BUILD`, native Android traps, mobile auth) are in
`.agents/AGENTS.md` §6b–6f; read them before changing anything under
`frontend/src/mobile/`, `frontend/src/platform/` or `frontend/android/`, or any
API an installed app calls. A separate React Native/Expo app lives in
`mobile/` (its own repository, ignored by this one, with its own `AGENTS.md`).

Related: [ARCHITECTURE.md](ARCHITECTURE.md#5-frontend-architecture) (core /
platform split), [SECURITY.md](SECURITY.md#3-the-installed-app-session-bound-bearer-tokens)
(how the app authenticates), [FEATURES_AND_FLOWS.md](FEATURES_AND_FLOWS.md#android-client)
(push), [OBSERVABILITY.md](OBSERVABILITY.md#android-app) (Sentry on Android),
[ENGINEERING_LOG.md](ENGINEERING_LOG.md) (dated measurements and the phase
history).

---

## 1. What an installed app is

- **An installed app ships a frozen copy of the frontend.** Every installed APK
  keeps calling the API with the code it was built with, until the user
  updates. API changes must stay additive; nothing an old build calls may be
  removed or change shape. Use the version gate to nudge or force updates.
- Package `app.meetifyy` (debug builds `app.meetifyy.dev`). The page origin is
  `https://localhost` on Android (and on iOS via `"iosScheme": "https"`).
- Packages: `@capacitor/core`/`android`/`ios`/`cli` 8.5.x,
  `@capacitor/app` (back button), `@capacitor/push-notifications`,
  `@aparajita/capacitor-secure-storage` (Keychain/Keystore), plus local
  plugins `SystemUiPlugin` (system bar/window colours, IME insets),
  `PushSupportPlugin`, `InstagramStoriesPlugin`. Only a few Capacitor plugins
  are used.
- The app is **portrait-only** everywhere, including video fullscreen
  (decision 2026-11-04).
- Native projects (`frontend/android/`, `frontend/ios/`) are **committed
  deliberately**: a store release edits them by hand (permission strings,
  manifest, deep-link filters, icons, splash, signing), and that would be lost
  if they were treated as build output. Ignored: Gradle/Xcode output, `Pods/`,
  `.gradle/`, `local.properties`, and each platform's copied `public/` (that is
  `dist-mobile` again). ESLint ignores `android/**` and `ios/**`.

### What differs between the two builds

| | Why |
|---|---|
| Opening screen replaces `/` | The website's `/` is a marketing landing page; someone opening the installed app already has it. One route, passed as a prop. |
| No service worker | A caching worker in a WebView can serve its copy of the *deployed site* instead of the reviewed bundle; iOS has no SW support at all. Absent from `vite.mobile.config.js` (vite-plugin-pwa never loads), not skipped at runtime. |
| No web version gate | A bundled app has no deployment to be stale against; it has its own native version gate (below). |
| No Vercel analytics | Reports to a web project. |
| Native API origin | The web `ApiOrigin` derives the host from `window.location`, which reads `localhost` in a WebView. `platform/capacitor/apiOrigin.js` returns the configured origin and probes nothing; private media URLs also go through `ApiOrigin.privateMediaTarget()`. |
| Native session source | Tokens in secure storage plus `x-session-id`, not cookies. |
| `@supabase/auth-js` lazily loaded | The mobile build aliases `@shared/lib/supabase` to `src/mobile/supabaseFacade.js` (same exports, loads on first use, `onAuthStateChange` keeps its synchronous contract): entry chunk −97 KB. |
| Web-only assets dropped | `dropWebOnlyPublicAssets` removes the iOS PWA splash screens (~1.14 MB), `robots.txt`, `version.json`, the OG image. |
| Base path | `base: '/'` explicitly. `./` would break client-side routing (`/messages/abc` would resolve `./assets/x.js` to `/messages/assets/x.js`). |

**What needs a new APK:** any frontend change (component, CSS, route, copy,
logic), anything in `frontend/public/`, icons, splash, native theme,
`MainActivity`, Gradle, Capacitor config or plugins. Backend, API, database,
and content or flags served by the API reach installed apps immediately — which
is exactly why a backend change that assumes a new frontend breaks every
installed app the moment it deploys. The bundle inside the APK is ~196 files /
~5.8 MB, loaded from `https://localhost` with no `server.url`. If over-the-air
updates are ever added (Capgo, Capawesome, OtaKit; Appflow is discontinued and
CodePush dead), they may replace only the web layer, never native code; check
the plugin's licence first (Capgo is AGPL-3.0).

**Native traps that have already bitten:** `gradlew` must stay mode `100755`;
XML resource comments cannot contain `--` (aapt2 fails); `android:background`
is not `android:windowBackground` (only the latter paints the window before the
WebView renders); Android 12+ ignores `android:background` on a
`Theme.SplashScreen` and needs `postSplashScreenTheme`; every launch surface
(splash, window, WebView) needs a `values-night` variant; a WebView with no
explicit background draws white (set it in `MainActivity`).

**A side-effectful import survives tree-shaking even when the branch folds:**
`@aparajita/capacitor-secure-storage` calls `registerPlugin()` at module scope
and once shipped to the production website although `IS_MOBILE_BUILD` folded
its only use away. If a shared module can reach a plugin, `import()` it
lazily; CI checks for Capacitor code in the web bundle.

**The build-flag trap.** Anything that gates a lazy import or a whole
platform-only block must use a constant Vite can fold — `IS_MOBILE_BUILD` (and
`IS_DEV_BUILD`), direct `import.meta.env` comparisons in `config/index.js` —
never a property on a runtime object. Gating on `config.isMobileClient` once
shipped the native origin in the web bundle and the 40 kB landing page in the
app; neither broke at runtime, which is what let it survive. CI guards both
directions: `dist-mobile/` must **not** contain `LandingPage-*.js`, `dist/`
**must**; and `dist-mobile/` must contain no `sw.js`, `workbox` or
`serviceWorker.register`.

### Version gate

`GET /api/app/version` is public, cached for 60 s, and **must remain public and
fail open**. It reports, per platform:

- `MOBILE_MIN_VERSION_*` — below this, the app shows a blocking update wall.
- `MOBILE_LATEST_VERSION_*` — below this, the app shows an update *nudge*.

`MOBILE_STORE_URL_ANDROID` (default the Play Store page for `app.meetifyy`)
and `MOBILE_STORE_URL_IOS` are where the wall and the nudge send the user. The
app checks at cold start and on resume.

They have different roles — MIN blocks (the app refuses to run), LATEST shows a
dismissible banner; one shared value would turn every routine release into a
forced upgrade. Raise MIN only for a broken or unsafe release, never for a
feature. Defaults (`0.0.0`, gating nobody) live in
`app.config.ts` and must not be changed. Values are set per environment in the
Container App config by the owner. After an additive change that old builds
handle imperfectly, raise only `LATEST`; raise `MIN` only when old builds are
actually broken.

---

## 2. Building

### Scripts (`frontend/`)

| Script | Does |
|---|---|
| `npm run dev:mobile` | Vite dev server for the mobile build (port 3001; also started by root `npm run dev:services`). |
| `npm run build:mobile` | Production-mode mobile bundle into `dist-mobile/` (loads `.env.production`). |
| `npm run build:mobile:dev` | Development-mode bundle (loads `.env`/`.env.development`). |
| `npm run mobile:sync` | `build:mobile && cap sync` — never run `cap sync` alone, it copies whatever is in `dist-mobile/` and silently ships the previous bundle. |
| `npm run mobile:apk` | Debug APK via `scripts/build-apk.mjs` (development mode, dev API). |
| `npm run mobile:apk:release` | Release APK (Meetifyy key, prod API, `.env.production`). |
| `npm run mobile:aab:testing` | App bundle for store testing. |
| `npm run mobile:icons` | Regenerates launcher icons from the Meetifyy mark. |
| `npm run mobile:android` / `mobile:ios` | Sync and open the native IDE project. |
| `npm run preview:mobile` | Serve the built mobile bundle in a browser. |

Built APKs go under `local/apk/` (`dev/`, `release/`, `live/`), which is
git-ignored. Sentry source-map upload during APK builds is described in
[OBSERVABILITY.md](OBSERVABILITY.md#android-app).

**Use the development-mode build for debug APKs.** `vite build` defaults to
production mode, which loads `.env.production` and would bake the
**production** API origin into a debug APK. Only `VITE_`-prefixed keys are
inlined — no server secrets.

### Toolchain on this machine

The toolchain lives **outside the repo**, under `~/.local/android/` (no root,
no system directories touched):

| Piece | Path | Note |
|---|---|---|
| JDK 21 | `~/.local/android/jdk21` | Capacitor 8 compiles at source level 21. JDK 17 fails with `invalid source release: 21`. |
| Android SDK | `~/.local/android/sdk` | cmdline-tools + platform-tools + `android-36` + `build-tools;36.0.0` |

`frontend/android/local.properties` points Gradle at that SDK and is
git-ignored. Android Studio is not needed. Manual equivalent of the scripts:

```bash
export JAVA_HOME=~/.local/android/jdk21
export ANDROID_HOME=~/.local/android/sdk
export PATH="$JAVA_HOME/bin:$PATH"
cd frontend && npm run build:mobile:dev && npx cap sync android
cd android && ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Logs while it runs: `adb logcat | grep -i -E 'chromium|capacitor|meetifyy'`.

### Live-reload APK (local development against a local API)

A live APK loads the mobile Vite dev server instead of a bundled copy. Rules,
learned from mistakes recorded in the engineering log (2026-09-27):

- Use the **live** artifact (`local/apk/live/meetifyy-live-local.apk`), not
  the bundled debug APK, when live edits are wanted.
- The designated mobile dev server is **port 3001**. A port number does not
  imply which API a server targets: check the running server for
  `VITE_CLIENT=mobile` and `VITE_API_URL=http://localhost:4000`.
- The packaged `server.url` must be `http://localhost:3001/` — not
  `/index.mobile.html`, which becomes React Router's path and renders "Page not
  found".
- Forward both ports: `adb reverse tcp:3001 tcp:3001` and
  `adb reverse tcp:4000 tcp:4000`.
- Verify the embedded `assets/capacitor.config.json`, then **look at the
  device** before claiming the intended screen works. A successful build and
  install is not verification.
- The committed Capacitor config never carries a live `server.url`; restore any
  temporary generated configuration after packaging.

---

## 3. Auth and lifecycle on the device

Summary (full design in [SECURITY.md](SECURITY.md#3-the-installed-app-session-bound-bearer-tokens)):

- Access token (with expiry), refresh token and session id in Keystore-backed
  secure storage; `x-session-id` on every request and in the socket handshake.
- **Local-first boot:** with a stored refresh token and a saved profile, the
  app opens on that account immediately and verifies with the server behind it
  (`AuthContext.jsx`). A refusal tears everything down
  (`clearLocalSession`); offline keeps the cached account.
- **Feed snapshot** (`mobile/feedSnapshot.js`): the first Home page (≤ 12
  posts) is saved after each real fetch and restored before the first render as
  stale data (it refetches). Scoped to the user id, in `SESSION_SCOPED_KEYS` so
  every exit clears it, at most 3 days old.
- **Launch renewal waits until the app is visible** (`whenForeground`), so a
  process the OS pre-started in the background (Vivo `preStart_up`) never
  rotates tokens it may be killed before storing. The refresh asks for the
  profile (`includeProfile: true`) so cold start needs one auth round trip, not
  two; the transport answers the next `GET /api/auth/session` from it once,
  within 15 s, and only while the stored refresh token is still the one it
  arrived with.
- **Resume:** `refetchOnWindowFocus` is on in the app (the WebView does fire
  `visibilitychange`), except for infinite lists (feed, community posts, chat
  history…), which have pull-to-refresh and socket updates.
- **Background:** Capacitor's `KeepRunning` defaults to true, so the WebView is
  never paused. After **30 s hidden** the socket disconnects cleanly (short
  trips to the photo picker or a share sheet are unaffected) and reconnects and
  re-syncs on return. Not `KeepRunning=false`, which would pause every JS timer
  app-wide (riskier for in-flight uploads). The website is unchanged: a
  background tab is a normal way to use it.
- **Socket revival:** after Socket.IO exhausts its 15 reconnect attempts
  (~2 min), the next resume or `online` event reconnects it once. It does not
  redial a socket the server disconnected (refused or revoked session).
- Android Keystore invalidation after a biometric/PIN change must degrade to an
  ordinary sign-out, never a crash (an unmeasured assumption, A8 in the log).

---

## 4. Native UI behaviour

- **Splash:** never uncover the page on the WebView's first draw (that frame
  is blank). Since 2026-10-26 the system splash is handed to the app at the
  activity's first frame and held as a view until the page reports ready
  **and** `postVisualStateCallback` confirms the WebView has drawn it; only then
  does the exit run (logo first, then background). Holding the system window
  instead cost a ~300 ms hand-over. Splash, window and launch shell share
  colours (`#FDFDFD` light, `#121212` night) and the same mark; a blocking
  inline script applies the saved theme before first paint.
  `reportFullyDrawn` is sent when the first screen shows content and the splash
  has begun to uncover it.
- **The splash comes back on a warm return.** Android 12+ shows it again when
  it has no snapshot of the app (the I2208 does this coming back from Chrome via
  Recents) and hands it to the same activity. The exit is tracked per splash
  (`exitingSplash`); a leftover `SplashScreenView` (check `dumpsys activity
  top`) was the "white screen on returning from the browser".
- **A lost WebView renderer must not end the app.** The system routinely
  reclaims a backgrounded app's renderer. `MainActivity.onRendererLost` claims
  `onRenderProcessGone` and recreates the activity: a reclaimed renderer
  reopens the same page, a crashed one reopens at the start, and a third loss
  within a minute falls back to the default. The recreated activity starts
  from a plain launcher intent (the bridge would replay an old deep link or
  notification tap), and the dead WebView is destroyed in the callback. Test
  with CDP `Page.crash` and `Page.navigate` to `chrome://kill` while Chrome is
  in front.
- **System bars:** the page paints transparent system bars itself, so status
  bar, header and navigation bar change in the same frame on every navigation
  (`installSystemBars`, `useSystemBars({ canvas, scrollThrough, navigation })`).
  Never set a bar's colour natively; the only native calls are
  `SystemUi.setIcons`, `setWindowColor`, `setColors` (theme for the next cold
  start) and `getInsets`. The strips are `html::before`/`html::after` in
  `mobile.css` (z-index 900 top, 90 bottom), written inside an animation frame.
- **Keyboard — it slides over the page** (since 2026-10-13, commit
  `d65d4799`). The WebView never resizes for the keyboard:
  1. `SystemUiPlugin` zeroes the IME inset it hands the WebView (otherwise the
     WebView shrinks its visual viewport and restyles the page ~80 ms before
     anything else knows) and dispatches **one** `meetifyy:ime` event per
     transition — `{ visible, height, duration, startedAt }` — at the
     **start** of the IME animation (`WindowInsetsAnimationCompat.onStart`),
     never per frame. `height` includes the navigation bar's area.
  2. `useKeyboardInset` (`shared/hooks/`) writes once on `<html>`:
     `--kb-inset`, `--kb-duration`, `--kb-easing` (the IME's curve), a negative
     `--kb-delay` so the page starts where the keyboard already is (without it
     the page trailed 66 ms on open and 51 ms on close), and
     `data-keyboard-open`.
  3. Consumers lift with a compositor transform:
     `transform: translate3d(0, calc(-1 * var(--kb-inset, 0px)), 0); transition:
     transform var(--kb-duration, 0ms) var(--kb-easing, ease-out) var(--kb-delay, 0ms);`
     A bar that already pads for the navigation bar rises by
     `--kb-inset - env(safe-area-inset-bottom)`.
  4. Dialogs and sheets that make room by layout (reading `--kb-inset`) slide
     with the keyboard automatically: `keyboardSheetRise` measures the sheet
     around the write and plays the difference back as a `translate` FLIP on the
     keyboard's curve (a sheet that is also shortened follows its top edge).
     Every keyboard surface must slide this way, proven per frame on a device.
  5. Full-screen scrollers (login/signup) get scroll room from
     `useKeyboardRoom` (`--kb-room` on an `::after` box with a matching negative
     margin), so nothing re-centres or jumps; `ensureFocusedVisible` scrolls the
     focused field into view a frame later.
  6. `KEYBOARD_OVERLAYS_PAGE` (`shared/utils/keyboardOverlay.js`) is true only
     in the installed Android app. On iOS the visual viewport shrinks and pans,
     and the website on Android resizes the layout viewport (tracked as
     `--kb-layout-shift`), so lifting there too would move things twice.

  Superseded, do not reintroduce: shrinking the WebView to the final size at
  once (a window-coloured strip for the whole ~250 ms slide), and padding it
  frame by frame while the IME moves (2026-10-11 → 10-13: each resize cost the
  page 60–90 ms of restyle, only 3–4 heights reached the page, and closing left
  ~5 blank frames). `setWindowColor` remains only as a backstop for anything
  that still exposes the window. Ambient gradients are sized to `--app-vh`,
  which is now simply 1% of the constant viewport height.
- **Scroll-driven animations stall flings in the WebView.** `animation-timeline:
  scroll()/view()` made fast flicks on a freshly mounted Profile freeze ~1.6 s.
  Use variables written from the scroll event (`useCollapsingHeader`) instead;
  never `animation-timeline` in app code.
- Never scale the live WebView or shrink a page for page transitions (slides
  and the centre-opening transition are screenshot-based).
- Bottom insets reach the stylesheets through `src/mobile/safeAreaPostcss.js`.
  `Error injecting safe area CSS: TypeError…` twice at first paint is
  Capacitor's own `SystemBars.java` running before `documentElement` exists —
  known benign.
- Launcher icon: adaptive, background `#FFFFFF` light / `#202020` night, with a
  `monochrome` layer for themed icons; maskable PWA icons keep the mark at 0.42
  of the canvas inside the safe circle.

---

## 5. Device testing

Verify native and visual behaviour with **screen recording, not screenshots**:
a 70 ms colour mismatch is invisible in a screenshot.

- **CDP into the WebView** (debug builds):

  ```bash
  adb forward tcp:9222 localabstract:webview_devtools_remote_$(adb shell pidof app.meetifyy)
  curl -s http://127.0.0.1:9222/json      # lists the page + its websocket URL
  ```

  `Network.enable` reports `Set-Cookie` and Chrome's `blockedCookies` with
  reasons; `Page.captureScreenshot` is the reliable screenshot when
  `adb exec-out screencap` returns empty files. `chrome://inspect` works too.
- **Startup:** `am start -W` (TTID, `Displayed`), the `Fully drawn` line
  (TTFD), the debug-only `MeetifyyLaunch` log line, CDP `performance` marks
  (`meetifyy:auth-decided`, `:surface`, `:splash-release:*`, `:fully-drawn`),
  `atrace` for native slices.
- **Frames:** `adb shell screenrecord --size 720x1604`, `ffmpeg -vsync 0` to
  frames, `ffprobe` timestamps, per-frame pixel sampling; `dumpsys gfxinfo` /
  `framestats` for transitions and scroll.
- **Flings:** measure on a fresh mount (leave the page and re-enter) with
  `adb shell input swipe`; never bisect by editing stylesheet rules through the
  CSSOM — edits persist across remounts and contaminate later runs.
- **Interleave A/B runs** (reinstall old and new APKs alternately): the phone's
  speed drifts 10–30% over a long session (heat). Debug builds run without AOT,
  so native start is slower than a Play release.
- **Input gotchas:** taps are **screen** coordinates (add the 88 px status bar
  to a `getBoundingClientRect` value), and the layout moves when the keyboard
  opens, so measure a button's position immediately before tapping.
- Installing a release-signed APK removes the debug install and its sign-in.
- In a live-reload UI iteration loop, skip on-device verification; the owner
  checks and reports.

The reference device is a vivo/iQOO I2208 (Snapdragon 4 Gen 1, 6 GB,
Android 14, 1080×2408 @ 440 dpi, 60 Hz, WebView Chrome 153–155). Lower-end
devices have not been tested. iOS has not been run at all (needs a Mac).

---

## 6. Performance: current state

Measured on the I2208; earlier numbers, methods and before/after tables are in
[ENGINEERING_LOG.md](ENGINEERING_LOG.md).

### Start-up

Measure start-up on the **perf build**, never the debug APK: a debuggable app
is not run from optimised code, and the same bundle reveals Home at +2.3 s
debuggable and +1.36 s compiled like a release.

```
cd frontend
npm run mobile:apk -- perf            # dev app, release-compiled, inspectable; keeps the sign-in
adb install -r ../local/apk/perf/meetifyy-perf-<date>.apk
npm run measure:startup -- --runs 8   # cold starts; add --warm for warm ones
npm run check:mobile-bundle           # the start-up bundle budget (also in CI)
```

`measure:startup` prints `am start -W` TotalTime, `Displayed`, `Fully drawn`,
the splash reveal (logcat tag `MeetifyyLaunch`) and the page's own marks. The
in-app number is navigation start → `meetifyy:home-painted`. Setting
`localStorage.meetifyy_perf = "1"` in the WebView inspector also keeps the
launch's timings in `window.__meetifyyPerf.entries`. Runs vary by 10–20% with
device heat: compare builds interleaved, not hours apart.

| Cold start, I2208, perf build, signed in, saved feed | 2026-11-11 before | after |
|---|---|---|
| `am start -W` TotalTime (native window) | 572 ms | 565 ms |
| Process start → page navigation start | 321 ms | 302 ms |
| In-app: Home in the DOM | 1007 ms | 710 ms |
| In-app: Home painted | not marked (≈1080) | 782 ms |
| Process start → splash starts to lift | 1360 ms | 1171 ms |
| Fully drawn (TTFD) | 1475 ms | 1281 ms |
| Layout shift (CLS) | 0.005–0.009 | 0 |
| Warm start TotalTime | 123 ms | 104 ms |
| Entry chunk (development-mode mobile build) | 786 kB | 847 kB (Home included) |

What the remaining time is, in order (cold):

1. **~300 ms before the page exists.** `bindApplication` ~110 ms, then
   Chromium's own initialisation inside the WebView's constructor, ~240 ms on
   the UI thread.
2. **~235 ms from navigation start to the first request.** The renderer
   process starting. Nothing of the app's runs in it.
3. **~100 ms evaluating the entry modules and ~220 ms for the first render**,
   against 20 ms and 113 ms for the same work on a warm reload. The difference
   is compilation: the WebView keeps **no V8 code cache** for responses served
   through `shouldInterceptRequest`: `Code Cache/js` only ever holds
   ~210-byte markers. (Chromium's loader for such responses sets no response
   time, which is the likely reason; not confirmed.) Every cold start compiles the
   bundle from source, which is why the entry bundle has a budget.
4. **~150 ms from "page ready" to the splash lifting.** The WebView's first
   content frame takes that long on the render thread. It was the same with
   the feed hidden, the header, the navigation, the drawer or the background
   hidden, images removed, or every compositing hint removed; only an empty
   page avoids it.

The 500 ms in-app target is not met on this phone: items 2 and 3 alone are
~550 ms. Getting there needs compiled-code caching (serving the bundle over a
real HTTP loopback server, or a far smaller entry), not more of the same.

Fixed along the way (2026-10-05 → 10-26): serial auth round trips at boot,
lazy `ReportModal`/image compressor/auth-js/Sentry, invisible
`backdrop-filter`s (bottom nav −30% GPU per frame; Activity screens on touch
devices), per-bubble `will-change`, users-map identity churn re-rendering every
post and bubble, per-frame video timer writes, conversation-list cache keys
never invalidated, unindexed comment-reply query, missing-thumbnail retries
(24 h memory), small avatars loading 512 px originals, feed videos without
posters, `SharedPreferences.commit()` on every launch, 844 KB of unused splash
PNGs, refresh-rotation sign-outs, tokens in logcat.

### Decided against, or open

| Item | State |
|---|---|
| Socket.IO WebSocket-first | Rejected: campus proxies hang WebSocket attempts for the full timeout; polling starts after auth and doesn't block UI. |
| Pull-to-refresh lazily attaching its non-passive `touchmove` | Not changed: Chrome derives blocking from the handler region on commit; needs a device trace. |
| R8 / `shrinkResources` for release | Open (`minifyEnabled false`; `classes.dex` is 38% of the release APK). Needs an on-device release smoke test. |
| Chat thread virtualization | Not done: `content-visibility: auto` on reverse-anchored chat lists causes scroll jitter; real virtualization needs dedicated testing of scroll anchoring. |
| Skeleton page-CSS splitting | Left: visual-regression risk for a small gain. |
| Session payload's unbounded follower/following/bookmark arrays | Plan: ship clients that read counts and fetch on demand → raise the minimum version → drop the arrays. |
| V8 compile hints, no splash exit listener, `WebViewCompat.startUpWebView` | Tried and rejected with numbers (see the log). |
| Version and legal checks fire on every resume (`UpdateGate.jsx`) | Open (medium). |
| Unbounded module-level URL sets; `MediaCacheManager` never evicting | Open (low). |
| Vivo pre-started process showing logo → shell → logo → page | Seen once, not reproduced. |

### Open device checks

Recorded as not yet run on hardware: iOS (launch, swipe-back vs the router,
cookie/ITP behaviour, deep links), offline launch, the full signup on the APK
after `3f58667a` (OTP → avatar → Create Account lands on `/home` and survives a
restart), Activity Detail and the video viewer bars (no test data on dev), an
end-to-end FCM push, and slow-network emulation.

### Store-release blockers (as last recorded)

- A reviewer test account (originally blocked because signup required a
  verified college email; open signup removed that requirement — confirm).
- Age gate (18+): `User.birthday` was optional and unvalidated.
- Privacy labels / Data Safety: not written.
- Route restore after app kill: not built.
- No browser or native end-to-end tests.
