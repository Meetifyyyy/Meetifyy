# Meetifyy Android performance audit

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

## Baseline measurements

### Cold start (signed in, 4 runs, page timeline from navigation start)

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

### Home boot network (one run)

19 API/XHR requests in the first 3.6 s. They include `/api/app/version`,
`/api/legal/documents`, `/api/instant-match/state`, `/api/communities/mine`,
`/api/communities`, `/api/users?limit=20` (434 ms), `/api/media/signed-urls`,
and **7 Socket.IO long-polling XHRs** before the WebSocket upgrade.

### Bundle (mobile build)

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

## Critical

### C1. Cold start waits on two serial auth round trips
- **Evidence (measured):** refresh 1.3–2.4 s, then `/session` 0.24–0.95 s, strictly serial; splash backstop fires.
- **Root cause:** the native access token is kept in memory only (a deliberate security choice, `platform/capacitor/sessionSource.js`), so every launch must refresh first. The refresh response did not say *who* the session belongs to, so `GET /api/auth/session` had to follow it. Server side, the refresh is itself serial: Redis rate limit → 3 DB round trips in `rotate` → Supabase HTTPS refresh → 1 DB write (`auth.controller.ts` `refreshSession`, `user-session.service.ts` `rotate`). On dev the API (UAE North) and DB (Singapore) are in different regions, so each DB trip costs ~100 ms.
- **Fix:** the refresh optionally (`includeProfile: true`) loads the profile *concurrently* with the Supabase call and returns it; the transport answers the boot probe from it. This is additive: older apps ignore the field, and a new app against an older API falls back to the GET.
- **Not done (needs your decision):** persisting the access token in Keystore would skip the refresh entirely within its 1 h lifetime, but contradicts the documented "fewer copies of a secret" design.
- **Risk:** auth path; §9b invariants checked (profile only returned after the provider refresh succeeds; failures omit the field).

### C2. ~910 KB of JS must be parsed before the first network request can start
- **Evidence (measured DCL 520–800 ms; confirmed by sourcemap):** `@supabase/auth-js` 98 KB is in the entry although mobile only needs it for signup `verifyOtp`. `ReportModal` 100 KB and the image compressor 52 KB are on the Home path but used only on tap/upload. The render-blocking CSS carries about 90 KB of page stylesheets imported by eager skeletons.
- **Fix:** lazy-load `ReportModal` and the compressor (done); auth-js and skeleton-CSS splitting are documented as next steps.
- **Hypothesis (unverified):** Capacitor serves assets via `shouldInterceptRequest`, which may prevent V8 code caching, so every launch recompiles. Not confirmed from an authoritative source, and needs a trace.

---

## High

### H1. Every feed image downloads twice, starting with the full-size original
- **Confirmed:** post media `url` is `/api/media/<key>` (`backend/src/posts/post-view.ts:77`). That is a 302 to the 1920 px original, rendered first. Then a batched `POST /api/media/signed-urls` swaps it for the 1080 px `_thumb.webp` (`MediaGrid.jsx:434-537`).
- **Cost:** about one original (150–500 KB) wasted per image, plus a redirect hop and the boot-time `/signed-urls` call.
- **Fix:** server returns the public thumbnail URL with the post, for public keys only.

### H2. Avatars load 512 px originals into 32–48 px slots
- **Confirmed:** `Avatar` takes `thumbnail` as an opt-in; only 1 of 52 call sites passes it, though a 160 px thumb is uploaded for every avatar.
- **Fix:** default to the thumbnail for small sizes, falling back to the original on error.

### H3. Presence and conversation events re-render every post body and chat bubble
- **Confirmed:** `handlePresenceUpdate` (`SocketManager.jsx:309,392,407`) maps to a new array even when nothing matched. That rebuilds `UsersMapProvider`'s value at the app root, and every `RichText` (each Post, Comment, Message) plus `MessageBubble` consumes it, bypassing `memo`.
- **Fix:** return the same array when unchanged; give the users map a stable identity per entry.

### H4. No pause/resume handling
- **Confirmed:** `AppLifecycle` exists only as an interface. Nothing subscribes. `mobile/main.jsx` disables `refetchOnWindowFocus` claiming resume is handled elsewhere, but it isn't. The socket heartbeat (25 s) keeps running in the background, data is never refreshed on resume, and the socket gives up after 15 attempts (~2 min) and is never reconnected.
- **Fix:** on `visibilitychange`, pause the heartbeat while hidden; on resume, reconnect a dead socket and refetch stale active queries.

### H5. Socket.IO always starts with HTTP long-polling
- **Measured:** 7 polling XHRs per boot. Config is `['polling','websocket']` (`useGlobalSocketStore.js:96`), deliberate for filtered campus networks.
- **Fix:** Socket.IO's documented WebSocket-first form, `transports: ['websocket','polling']` + `tryAllTransports: true`, keeps the polling fallback.

### H6. Opaque bottom nav runs a full-width backdrop blur on every scroll frame
- **Confirmed:** `BottomNav.module.css` uses `backdrop-filter: blur(20px) saturate(180%)` over a solid `#fff`/`#000` background, so the blur is invisible but still computed.
- **Fix:** remove it.

### H7. Feed videos never use their uploaded posters
- **Confirmed:** the feed query selects no poster (`posts.service.ts:857`), so each rendered video, off-screen included, mounts `<video preload="metadata">`. Phone MP4s with a trailing `moov` box can pull MBs.
- **Fix:** poster-first (needs a backend select plus a `MediaGrid` change). Documented, not done.

### H8. Conversation-list Redis cache is never invalidated
- **Confirmed:** written as `user:conversations:v2:…` but invalidated as `user:conversations:…` (`messages.service.ts:270`, `users.service.ts:2046`, `group-chats.service.ts:88`). A refetch after sending can be served a list up to 60 s stale, which overwrites correct client state.
- **Fix:** one key prefix for both.

---

## Medium

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

## Low

- Shimmer skeletons animate `background-position` (paint every frame); several `box-shadow` pulse animations.
- Unbounded module-level URL Sets (`MessageBubble.loadedImageUrls`, `Avatar`, `imageWarmup`) and `MediaCacheManager` never evicting expired entries.
- `GET /api/users?limit=20` on Home boot (434 ms) feeds a users map with the 20 newest signups, which is not useful for mentions.
- `JwtGuard` runs session, account and legal lookups serially on a cache miss.
- Idle route prefetch misses PostDetail, SearchResults, ActivityDetail and CreateActivity.
- Logo `meetify_logo.webp` is 1024² shown at 28 px.

## Checked and fine

The feed is window-virtualized with memoized posts. Notifications are virtualized. Socket listeners are balanced (on/off). The system-bar bridge calls are deduped (0 per scroll). Only three Capacitor plugins are used. No service worker in the app. The emoji data and framer-motion stay off the startup path. Gzip is on. Refresh is single-flight. The feed request starts in parallel with the session probe. Indexes cover feed, notifications and messages. Upload pipeline converts to WebP with thumbnails, and verification media stays private.
