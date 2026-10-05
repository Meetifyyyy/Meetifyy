# Meetifyy Android performance work — what was done

Date: 2026-10-05 · Branch: `development` (uncommitted) · Findings and baseline:
[PERFORMANCE_AUDIT.md](PERFORMANCE_AUDIT.md)

Test device: Vivo I2208 (Snapdragon 4 Gen 1, 6 GB, Android 14), debug APK built
from this tree, against the deployed **dev** API. Measurement used the Chrome
DevTools Protocol against the app's WebView, `am start`, the debug `MeetifyyLaunch`
log, and `dumpsys gfxinfo`.

## How it was investigated

1. Six focused audits ran in parallel: Capacitor/Android, React rendering, API/backend, media/network, startup/navigation, and memory/CPU/scroll.
2. On-device baselines were taken before any change: cold start ×7, boot network waterfall, resume behaviour, and image requests.
3. External research covered three questions:
   - Socket.IO transport order (`tryAllTransports`);
   - passive vs non-passive touch listeners in Chrome;
   - whether Android WebView code-caches Capacitor's intercepted responses. This one stayed unresolved, so nothing was changed on its basis.
4. Each fix was verified on the device where it could be observed. One change was reverted when its premise turned out to be false (see "Tried and reverted").

## Results (measured)

| What | Before | After | Notes |
|---|---|---|---|
| Bottom-nav scroll, frame time p90 (gfxinfo, 3×A/B, same build) | 24–28 ms | **18–20 ms** | Invisible `backdrop-filter` removed |
| Bottom-nav scroll, GPU time p50 / p90 | 8–9 / 9 ms | **6 / 6–7 ms** | about 30% less GPU work per frame |
| Feed post whose thumbnail does not exist | 780–1,036 ms uncacheable 404 on **every** mount and launch | paid once, then skipped for 24 h | measured from a clean state over two launches |
| Data refreshed when returning to the app | **nothing** | stale screens refetch (feed excluded) | `visibilitychange` verified to fire in the WebView |
| `mediaPipeline` chunk on the Home path | 62.9 KB | 9.9 KB | compressor (53 KB) loads on first upload |
| `ReportModal` (zod + react-hook-form) on the Home path | 100 KB parsed at boot | not loaded until a report is opened | 1 KB wrapper instead |
| Cold start, splash released (4 runs each) | 3.6–5.8 s, backstop fired in 2/7 | 3.6–3.9 s, backstop 0/4 | **Not attributable to these changes:** the refresh endpoint itself was faster in the second hour (1.1–1.6 s vs 1.3–2.4 s). Network variance dominates. |

### Not yet measurable on the device

The largest startup fix, removing the serial `GET /api/auth/session` after the
refresh, needs the backend change deployed to dev (CI on merge). The device
currently runs the new app against the old API. That proves the
**backward-compatible fallback** works: still signed in, same two calls. The
expected saving is the measured duration of that second call, **206–949 ms per
cold start**. Confirm after deploy by re-running the cold-start series:
`/session/refresh` should be the only auth request.

## Fixes implemented

### Startup / auth (backend + frontend)
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

### Bundle
- `ReportModal` is lazy-loaded through `LazyReportModal` at all seven call sites.
- `browser-image-compression` is dynamically imported on first upload.

### Rendering / scroll
- Removed the bottom nav's `backdrop-filter`: its background is opaque in both themes, so the blur was invisible but computed every frame.
- Removed `will-change: opacity` from every chat message's hover actions (one compositor layer per bubble).
- **Users map keeps its identity** unless a user in it actually changes. It is read by every `RichText` and `MessageBubble`, and was rebuilt on every message preview or unread update. That re-rendered every post body and chat bubble on screen per incoming message.
  - Correction to one audit: TanStack's structural sharing already made a no-op presence update free; the cost was in the map, not the presence handler.
- Video progress loops replace the timer text only when the second changes, instead of every frame. Each write was a DOM mutation that also woke the system-bar sampler.

### Network / media
- **Missing-thumbnail memory** (`shared/utils/missingThumbnails.js`): a thumbnail key is skipped for 24 h, persisted and bounded. It is recorded only once the original has loaded after the thumbnail failed, so being offline or a 5xx never marks it.
- **Small avatars use the 160 px thumbnail by default** (fixed size ≤ 48 px, which stays sharp at 3x). Previously 1 of ~50 call sites opted in. Verified on the dev API that `/api/media/<key>_thumb.webp` falls back to the original, unauthenticated, when no thumbnail exists, so this can only save bytes.

### Lifecycle / realtime
- **Refresh on resume:** `refetchOnWindowFocus` was off, on the premise that a WebView never fires focus. It does fire `visibilitychange` (measured), and the replacement `AppLifecycle.onResume` was never implemented. Now on, except for infinite lists (feed, community posts, chat history…). A resume refetch would re-request every loaded page and reorder the list. Those lists have pull-to-refresh and socket updates.
- **Socket revival:** after Socket.IO exhausts its 15 reconnect attempts (~2 min), the next resume or `online` event reconnects it once. It deliberately does not redial a socket the server disconnected (refused or revoked session).

- Socket-store readers (SocketManager, PostView, CommunityView, chat hooks) select single fields instead of the whole store, so a reconnect no longer re-renders those subtrees.

### Backend correctness / query cost
- **Conversation-list cache was never invalidated.** Entries are written under `user:conversations:v2:…`, but all three evictors used v1-shaped keys. A send, block or account deletion left lists stale for the full TTL. All four sites now share one key builder (`messages/conversation-list-cache.ts`) and evict with a direct `DEL` of the first pages clients refetch, rather than a keyspace `SCAN`.
- **Comment replies:** added `postId` to the per-depth reply query. `parentId` has no index, so each level scanned the `Comment` table; now it uses `(postId, createdAt)`. No migration.

### Android
- `SystemUiPlugin.setColors` skips the synchronous `SharedPreferences.commit()` when nothing changed, which is the common case at every launch.
- Deleted 11 unused Capacitor-template `splash.png` files (844 KB, unreferenced; the splash uses `meetifyy_splash_logo`).

## Final review (independent subagent, PR-style)

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

## Tried and reverted
- **`hasThumb` in the feed payload.** The idea was for the server to say which thumbnails exist (via the unique `objectKey` index). A read-only check on dev showed the database has a thumbnail row for posts whose thumbnail object **does not exist in R2**: rows are registered at presign time. The flag would have been wrong, so it was removed.

## Decided against, with reasons
- **Socket.IO WebSocket-first:** the code documents a measured reason for polling-first. Intercepting campus proxies hang WebSocket attempts for the full timeout. The polling XHRs start after auth and don't block UI.
- **Pull-to-refresh lazily attaching its non-passive `touchmove`:** Chrome derives blocking from the event-handler region, which updates on commit. A listener added during `touchstart` risks non-cancelable moves and a broken pull gesture. Needs a device trace before changing.
- **R8 / `shrinkResources` for release:** worthwhile (`classes.dex` is 38% of the release APK) but needs an on-device release smoke test. Installing a release-signed APK would remove the debug install and its sign-in.
- **Persisting the access token** to skip the cold-start refresh entirely: contradicts the documented "fewer copies of a secret" design. That's the owner's decision.

## Remaining bottlenecks and recommended next steps (by expected impact)

1. **Thumbnail uploads appear to fail silently** (high impact on bandwidth). On dev, the sampled posts have a `_thumb` DB row and no R2 object, and `mediaPipeline` swallows every variant-upload error. So the feed effectively downloads originals at 1920 px. Reproduce one upload with logging, and check production with a read-only request.
2. **Server refresh path:** fold `rotate`'s three DB round trips into one statement, and run `JwtGuard`'s session/account/legal lookups concurrently. Dev pays ~100 ms per DB trip (API UAE North ↔ DB Singapore); co-locating dev would also help.
3. **Entry chunk:** `@supabase/auth-js` (98 KB) is only needed for signup on mobile; skeletons import whole page stylesheets into the 301 KB render-blocking CSS.
4. **Create Activity / Activity Detail:** 10+ stacked `backdrop-filter`s. The gfxinfo A/B above shows what one full-width blur costs on this phone. Needs a design decision.
5. **Feed videos:** use the uploaded poster, and create `<video>` only on play.
6. **Chat thread:** not virtualized; at least `content-visibility: auto` on rows.
7. **Pause handling:** the 25 s presence heartbeat runs in the background.
8. **Session payload:** unbounded follower/following/bookmark arrays, which installed apps read, so it needs a release cycle.
9. Smaller items are listed in PERFORMANCE_AUDIT.md (Medium/Low).

## Verification
- Backend: 2,527 tests pass (one fewer than mid-session: a helper removed after review took its test with it); `npm run lint` (blocking, zero warnings) clean.
- Frontend: 208 files / 1,991 tests pass; `npm run typecheck` and `npx eslint .` clean; perf suite 3/3.
- Device: final debug APK built and installed (`adb install -r`, data kept). On the phone:
  - signed-in cold start; Home, Messages, a chat thread with media, Notifications, Communities, Crew, Settings and Profile render with no console errors;
  - resume refetch, thumbnail memory and the gfxinfo A/B were exercised as described.
- Not tested on the device: Create Activity, theme switching, slow-network emulation, and the APK against an API carrying the backend change.

---

## Round 2 (2026-10-05, later): launch flicker and slow reopen

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

### Found: launches can sign the user out (pre-existing, serious)
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

### Also found
Debug builds' Capacitor bridge logs secure-storage results, including the
refresh token, to **logcat**. Consider `"loggingBehavior": "none"` in
`capacitor.config.json`; release builds already don't log.

---

## Round 3 (2026-10-05): the remaining items, researched before fixing

Every item was re-checked against the code, then against external guidance,
before changing anything. Two audit claims turned out to be wrong or
incomplete, and are corrected below.

### 1. Surprise sign-outs (refresh-token rotation race) — fixed
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

### 2. Access token kept on the device — done, per OWASP
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

### 3. Tokens in logcat — done
- `"loggingBehavior": "none"`. Capacitor's docs warn its logging "can leak
  information on device".
- The default (`debug`) already logged nothing in release builds. Our own
  `MeetifyyLaunch` log is unaffected. Console output remains available over
  `chrome://inspect`.

### 4. Thumbnails missing — root cause found: **every** direct upload fails
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
  preflight in `docs/operations.md`, against
  `https://<account>.r2.cloudflarestorage.com/<bucket>/x`.

### 5. Background work — fixed (app only)
- Capacitor's `KeepRunning` defaults to true, so the WebView was never paused
  (verified in its source). The socket and the 25 s presence heartbeat ran until
  Android froze the process.
- Now, after **30 s hidden**, the socket disconnects cleanly. Short trips to
  the photo picker or a share sheet are unaffected. On return it reconnects and
  re-syncs.
- The website is unchanged: a background tab is a normal way to use it.
- Not `KeepRunning=false`: that pauses every JS timer app-wide, which is riskier
  for in-flight uploads.

### 6. Feed videos — fixed, per web.dev
- **Guidance:** web.dev's lazy-loading video article — poster plus
  `preload="none"`, upgraded via IntersectionObserver.
- Idle tiles now show the uploaded `_thumb.webp` poster.
- The first-frame `<video>` fallback mounts only within a screen of the
  viewport. The virtualized feed keeps off-screen posts mounted, and each one
  fetched video metadata.
- **Bug fixed:** multi-item grids rendered a video tile as `<img src={mp4}>`,
  which always errored and retried.

### 7. Chat thread — deliberately not changed
- `content-visibility: auto` on reverse-anchored chat lists causes scroll
  jitter: messages above the fold are never rendered, so they keep placeholder
  heights. Projects have removed it from chat for this reason.
- The safe wins are already in (no per-bubble `will-change`, no re-render storm).
- Real virtualization needs dedicated on-device testing of the scroll anchoring.

### 8. Guard lookups — parallel
- `JwtGuard` now *starts* the account-status and legal lookups beside the
  session lookup, which saves two serial DB round trips on a cold cache.
- The checks are still *judged* in the same order: a revoked session is always
  401 "signed out", never a suspension. A test pins the precedence and the
  overlap.

### 9. Startup bundle — `@supabase/auth-js` out of the entry
- The package declares no `sideEffects`, so it cannot be tree-shaken. The
  mobile build aliases `@shared/lib/supabase` to `src/mobile/supabaseFacade.js`
  (same exports; loads on first use; `onAuthStateChange` keeps its synchronous
  contract).
- **Entry chunk: 550,898 → 453,897 bytes (−97 KB, −17.6%).** The website build
  is unchanged.
- Skeleton page-CSS splitting was left: visual-regression risk for a smaller gain.

### 10. Create Activity / Activity Detail blurs — reduced on touch devices
- **Guidance:** CSS Filter Effects 2 — an element with `backdrop-filter` is a
  *Backdrop Root*, so nested backdrop filters only see the card's own fill.
- **Activity Detail:** the five blurs nested inside `.glass` were invisible at
  full GPU cost, plus a permanent `will-change: backdrop-filter`. Removed on
  `(pointer: coarse)`.
- **Create Activity:** the form fields blurred a background that is already a
  48–64 px blur. Removed on phones. Kept where the blur is visible: small
  controls over the sharp cover image, dropdowns, modals.
- Desktop keeps all of them.

### Session payload (unbounded follower/bookmark arrays) — plan, not changed
Installed apps read these fields, so removing them needs the version gate:
1. Ship clients that read counts and fetch lists on demand.
2. Raise the minimum version.
3. Then drop the arrays.

### Verification
- Backend: 2,542 tests; lint (blocking) and typecheck clean.
- Frontend: 2,013 tests; typecheck, ESLint and perf clean.
- Mobile bundle verified by an out-of-tree build.
- **Not yet verified on the device** (it disconnected mid-round): the persisted
  access token skipping the rotation on a second launch, logcat silence, the
  socket release after 30 s, and the blur and video changes on screen.
- The server-side recovery and parallel guard need a deploy to dev before they
  can be seen end to end.
