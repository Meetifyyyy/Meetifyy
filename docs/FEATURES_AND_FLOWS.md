# Features and flows

The documented application features and how they work end to end. A feature
not described here has no written design yet; read its module under
`backend/src/<module>` and `frontend/src/features/<feature>`.

Related: [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md) (feature list),
[BACKEND_AND_API.md](BACKEND_AND_API.md#10-api-contracts) (endpoint contracts),
[SECURITY.md](SECURITY.md) (sessions, reauthentication, cooldowns),
[MOBILE_APP.md](MOBILE_APP.md) (installed-app specifics).

---

## 1. Signup, Campus and college email

Status: released (migrations 14–16 are on `main`). Before this work, signup
required a college email and sign-in auto-linked a college from the login
email's domain; both are gone.

### Concepts (kept separate)

| Concept | Where it lives | Proven by |
|---|---|---|
| Account login / primary email | Supabase auth email = `User.email` | Supabase signup OTP, or the personal-email change OTP |
| Live selfie + ID ("Account verification") | `User.verificationStatus`, `VerificationRequest` | Admin review |
| Verified college email + affiliation | `CollegeAffiliation` | College-email OTP on the Campus page, or legacy backfill |
| Campus authorization | an **active** `CollegeAffiliation` whose college is active/approved/not deleted | server only |

`User.collegeId` / `User.collegeEmail` remain as a **mirror** of the active
affiliation so the many existing `collegeId` queries keep working. Only the
affiliation service writes them. The mirror is never nulled for legacy rows.

### New signups

- The signup email is the primary email (personal or college). It never grants
  an affiliation, even on a college domain; the user verifies a college email
  on the Campus page.
- **Gender:** `User.gender` is a nullable enum
  `Gender { MALE FEMALE NON_BINARY PREFER_NOT_TO_SAY }`. Required by the signup
  UI (sent in Supabase metadata `gender` and the profile PATCH), optional for
  the API (old APKs don't send it).
- `check-email` without `collegeId` checks only `User.email` (a login may equal
  someone else's college email) and returns `collegeId`/`collegeName` as a hint
  when the domain is approved, `collegeId: null` otherwise. It keeps its reason
  strings and returns `isValid: true` for non-college domains on signup.

### Legacy users

Every pre-existing account signed up with an email on an approved college
domain that Supabase confirmed by OTP. Migration 14 backfilled one
`CollegeAffiliation` (`method = LEGACY_PRIMARY_EMAIL`) per user where all of
these hold:

- `User.collegeId` not null, `deletedAt` null;
- the domain of `User.email` maps (via `CollegeDomain`) to that same
  `collegeId` (status not considered: the domain was approved at signup time);
- the normalized email is not claimed by any other row in the backfill
  (duplicates are skipped and reported).

`auth.users.email_confirmed_at` was checked by the dry-run report
(`backend/scripts/college-affiliation-report.ts`), because the migration cannot
read `auth` reliably across environments. Rows not matching were left without
an affiliation and use the Campus page flow. Nothing was deleted, no email was
transferred, and selfie status was unchanged.

### College email rules

- **Normalized** = NFKC, trim, lowercase, IDN domain to ASCII
  (`DomainValidatorService` rules); the local part is kept as typed,
  lowercased (no dot/plus stripping: institutions differ).
- `CollegeAffiliation.emailNormalized` is **UNIQUE across all rows including
  revoked ones**, until released. Checked before the OTP is sent, rechecked
  inside the verify transaction; the unique index is the final arbiter (P2002
  → generic 409). The error never identifies the owner:
  `{ code: 'college_email_unavailable' }`.
- One affiliation per user (`userId` UNIQUE). Changing college email = verify a
  new one: the verify transaction updates the user's row in place (old address
  released). Changing campus (an address of a different college) clears
  `isCampusRep`.
- The code must be for an ACTIVE domain of the chosen college; the OTP row
  stores the normalized `target` and `collegeId`, so verify cannot be
  redirected to another address or college.
- **Release:** the user removes the affiliation in Settings → row deleted
  (address free). Account purge deletes the row (FK cascade + explicit delete).
  **Admin revocation** sets `revokedAt`, clears the mirror and `isCampusRep`,
  and keeps the address reserved (audit) until an admin deletes it; a revoked
  user cannot re-verify or remove it.
- Changing or removing an existing college email needs a fresh
  reauthentication and respects the 30-day college cooldown
  ([SECURITY.md](SECURITY.md#8-email-change-security)).

### Personal email and email changes

- Existing users whose primary email is their college email can add a personal
  email in Settings → Email: OTP to the new address + reauthentication → the
  server sets the Supabase auth email (`admin.updateUserById`,
  `email_confirm: true`) and `User.email`. The college address remains on the
  affiliation; afterwards they sign in with the personal email.
- `User.email` stays unique. A personal email equal to another user's
  affiliation email is allowed as a login, but it cannot be verified as a
  college email by this account.
- After a sign-in email change a security notice ("sign-in email changed to
  j***@gmail.com; if this wasn't you, contact support") is queued to the
  **old** address (template `signin-email-changed.tsx`).
- `PATCH /api/users/me` no longer writes `User.email` at all (the old
  placeholder "auto-heal" and the body-`email` fallback are gone). The only
  writers of an existing account's `User.email` / auth email are
  `POST /api/account/email/verify` and the account purge's anonymization.
- The full security design (grants, cooldowns, the `auth.users` trigger) is in
  [SECURITY.md](SECURITY.md#8-email-change-security).

### Profile completion prompt

Shown to signed-in users when
`profileCompletion.needsPersonalEmail || profileCompletion.needsGender`.
Dismissible ("Later") per session, never blocks the app (migration 17,
`profile_prompt_snooze`, added a snooze).
`needsPersonalEmail` = the user has an affiliation AND `User.email` normalized
equals the affiliation email.

### Campus gating

Campus routes are gated by **affiliation**, not by selfie verification:

- `/api/users/campus`, `/api/users/directory`, `/api/campus-events*` answer
  `403 { code: 'campus_affiliation_required' }` without an active affiliation.
- `GET /api/communities/campus` keeps answering `[]` (as it did without a
  campus), and other endpoints that already returned `[]` for ineligible users
  keep doing so.
- `COLLEGE_ONLY` / `shareToCampus` activity reads use the affiliation.
- Campus-event writes additionally require `isCampusRep` and take the college
  from the affiliation, not from `User.collegeId`.
- `CampusAccessService` (`src/common/campus/`) performs one unique-index lookup
  per request, deliberately uncached.
- Campus listings (`/api/users/campus`, `/api/users/directory`) list only users
  with an active (not revoked) affiliation to that college, filtered through
  the relation; the mirror alone (legacy rows the backfill skipped) is not
  enough.
- **Same-college ranking boosts** also use the ACTIVE affiliation on both
  sides, not the mirror: people search (and campus-only community visibility in
  search), follow recommendations (campus arm + sameCollege/sameBranch/
  sameBatch), the people pickers (campus fill + boost, one batched affiliation
  lookup), the ranked home feed author boost, community recommendations
  (`campusMemberCount`) and trending (viewer campus + campus authors; cache key
  `trending:v2:*`). Search's viewer context (`resolveViewer`, also used for
  COLLEGE_ONLY activity discovery) reads the affiliation in the same query.
  Displayed college names on result cards still come from the mirror.
- On affiliation change the server emits `user:campus_changed`
  `{ campusAffiliation }`; clients drop campus query caches (the same list as
  `VERIFICATION_GATED_QUERY_KEYS`).

### Verification gates

The selfie/ID gate (`@VerifiedOnly`) is kept **only** on:

- messaging: DM create/send/forward, group chat create/send/forward/member
  add, message send/forward, message-core eligibility checks;
- creating posts (`POST` post create only);
- creating communities;
- creating activities;
- Instant Match (all socket events + `joinQueue`), including Instant Match
  discussion.

It was removed from: like/unlike, comment and comment like, bookmark, vote,
delete own post/comment, follow/unfollow, joining/leaving communities and their
requests (joining a community is **not** selfie-gated), community admin
actions on an existing community, joining/leaving/bookmarking activities and
invitations, discussion posts, campus users/directory, campus events reads.

Group chats: joining is messaging. `@VerifiedOnly` is on `addMember`,
`acceptJoinRequest` and `POST :id/join` / `POST :id/request` on both the
`/api/group-chats` and `/api/messages` controllers. The service re-checks too:
`joinGroupByInvite` refuses an ineligible joiner (also for approval groups, so
no un-approvable request is created), and `acceptGroupJoinRequest` refuses an
ineligible requester with `403 { code: 'JOIN_REQUEST_INELIGIBLE' }` and deletes
that request. `GET :id/invite` stays readable and includes
`requiresVerification`. Info edits, role changes, member removal and declining
requests are not gated.

### Old installed apps

Old APKs still send college-only signups and read `verificationStatus`.
Nothing they call was removed or renamed. What an old-APK user sees (checked
against the committed pre-change frontend):

| User | Old APK behaviour |
|---|---|
| Selfie-verified, has an affiliation (legacy backfill) | Unchanged: Campus works. |
| Selfie-verified, no affiliation | Campus gate is open client-side (it gates on `verificationStatus`); campus/directory/events answer 403 and the pages render their empty states; `/api/communities/campus` returns `[]`. The old APK has no Campus-page college-email flow, so they cannot fix this until they update. |
| Not selfie-verified, has an affiliation | Old client keeps Campus behind its "verify your student ID" gate although the server would allow it. Conservative, not a leak. |
| Not selfie-verified | Old client still blocks likes/comments/follows/joins client-side that the server now allows. Joining a group by invite answers 403 from the server; the old invite screen shows its generic error. |
| New signup on an old APK | Signs up with a college address as before, but no longer gets a campus from the domain. |

The session payload cannot paper over this: the only field old clients read
for the Campus gate is `verificationStatus`, which also drives messaging;
faking it would mislabel selfie status. The new fields (`campusAffiliation`,
`profileCompletion`, `gender`) are additive and ignored by old clients.

**Release step for such changes:** when the new build ships, set
`MOBILE_LATEST_VERSION_ANDROID` (and `_IOS` if applicable) so old installs get
the update *nudge*. Do NOT raise `MOBILE_MIN_VERSION_*` for this (nothing is
broken enough to force-update), and do not change the defaults in
`app.config.ts`. These are set per environment in the Container App config, by
the owner ([MOBILE_APP.md](MOBILE_APP.md#version-gate)).

### Help and legal copy

- Migration 15 (`open_signup_copy`, content only) rewrote the help articles that
  described college-only signup (create account, account verification, profile
  info, Instant Match, campus events, can't log in, verification email) and
  added `how-do-i-join-my-colleges-campus` and `adding-a-personal-email`. It
  only touched rows nobody had edited (`updatedAt = createdAt`); admin-edited
  articles must be reviewed by hand.
- **Legal documents.** The source text lives in
  `frontend/src/features/info/pages/legalDocuments.js` (static frontend
  content since commit `37f61b79`). Changes reach the database as
  `LegalDocumentVersion` rows published by migrations whose text is a
  verbatim copy generated from that file (regenerate, never hand-edit):
  16 (open signup + Campus verification), 21 (live verification), 32 (support
  email), 36 (full rewrite of Terms, Privacy, Cookie Policy and Community
  Guidelines, restarting history at version 1 — earlier versions deleted at the
  owner's explicit request) and 37 (account-deletion steps). A migration
  publishes silently (`requiresAcknowledgement = false`, previous versions
  archived, never deleted while acknowledgements reference them); an admin
  triggers the "please accept" notice from the portal (Legal updates), which
  publishes a further version of the same text that requires acknowledgement.
  (The original college-affiliation design note said legal text had no publish
  path and was left out of migration 14; migration 16 superseded that.)

---

## 2. Push notifications

Browser push for the website, native push for the Android app; one backend
path delivers both. Push is **off** until a deployment is configured and
`PUSH_ENABLED=true` is set.

Status (last recorded 2026-11-14): live in both environments.
- **Development:** a like on a phone running the debug APK (Firebase project
  `meetifyy-dev`) arrived end to end. The development website itself never
  receives push, by design: its service worker is blocked on non-production
  hosts so a cached app cannot bypass Cloudflare Access.
- **Production:** push was switched on with a fresh VAPID key pair and the
  `meetifyy-prod` service account, both as Container App secrets. A like
  reached desktop Chrome on meetifyy.app.
- **Android in production:** push needs a release APK built with
  `src/release/google-services.json`.

`setup-azure-prod.sh` now sets these up; `setup-azure-dev.sh` does not (see
"Push configuration").

### How it works

```
action commits (like, comment, follow, message, join ...)
  -> NotificationsService.createNotification       writes the in-app row, socket emit, unread count
       -> PushDispatcherService.enqueue*           synchronous, never awaited, never throws
            -> BullMQ queue "push" (Redis)         jobs hold ids only
                 -> PushProcessor                  re-checks everything at send time (PushAudienceService)
                      -> WebPushProvider  (VAPID, web-push)     -> browser push service -> sw.js
                      -> FcmProvider      (firebase-admin)      -> FCM -> Android system tray
```

Four layers, kept apart:

1. **Event + record.** Every category funnels through `createNotification`
   after its action committed. The row is the durable record. There is no
   outbox: a push is derived, best-effort delivery, and a queue or provider
   outage never removes the row or fails the action.
2. **Delivery.** `PushDispatcherService` enqueues; `PushProcessor` sends one
   provider call per registered device.
3. **In-app.** The socket emit happens before the push hand-off and does not
   depend on it.
4. **Read state, grouping, retries.** Below.

### Categories

| Category | Real event path | Push text |
|---|---|---|
| Direct message | `dm.controller` / `messages.controller` → `createNotification(MESSAGE)`; socket `message:send` → `realtime.gateway` | "You have a new message from [Name]." / "You have N new messages from [Name]." |
| Group message | `group-chats.controller`, socket `message:send` | title = group name, body "New message from [Name]" / "N new messages" |
| Removed from a group | `removeMember` → `enqueueForGroupRemoval` (not on leaving) | "You were removed from [Group]." (category Messages) |
| Post like | `posts.service` like path | "[Name] liked your post." ("[Name] and N others …") |
| Comment like | `posts.service` comment-like path | "[Name] liked your comment." |
| Comment on your post | `posts.service` addComment | "[Name] commented on your post." |
| Reply | `posts.service` addComment (reply) | "[Name] replied to your comment." |
| Mention | `mentions.service` | "[Name] mentioned you in a post/comment." |
| Activity invite | `activities.service` → `createActivityInviteNotifications` | "[Name] invited you to an activity." |
| Activity participant join | `activities.service.notifyHostOfJoin` (JOIN_REQUEST + ACTIVITY) | "[Name] joined your activity." |
| Follow | `users.service.followUser` → BullMQ `follow-notification` | "[Name] started following you." |
| Community join | `communities.service.joinCommunity`, public path | "[Name] joined your community." |
| Community join request | `communities.service.joinCommunity`, private path | "[Name] requested to join your community." |

The two community notifications are `NotificationType` values `COMMUNITY_JOIN`
and `COMMUNITY_JOIN_REQUEST` (not `JOIN_REQUEST`, which installed clients render
as "joined the activity"). Recipients are the owner and moderators whose role
may review requests (`roleCan(..., 'REVIEW_JOIN_REQUESTS')`), capped at 25.
Campus communities do not notify on joins. A repeated "Join" on a request that
is still pending does not notify again. Clients that predate these types show
the row's `body` ("Aarav joined Chess Club."), which reads correctly on its own.

SYSTEM and GROUP_INVITE rows stay in-app only. Instant Match messages are never
pushed (they have no Messages destination).

### Payload privacy

All push text is written in one file, `backend/src/push/push-payload.ts`, and
is not the row's `title`/`body` (those quote content for the in-app list).

- Who and what kind of thing only. Never message text, post or comment text,
  emails, or user ids.
- Routing data is the Intent wire format from
  `frontend/src/core/navigation/intents.ts` (`{v, t, id | username | conversationId}`).
  A chat routes by the conversation's public id.
- Collapse keys/tags/topics are a hash of the internal id, not the id.
- Android notifications are `visibility: private`: on a secure lock screen the
  system shows "Contents hidden" unless the user allows contents.
- Display names are stripped of control characters and capped at 40 chars.
- Logs never contain a token, an endpoint or a payload.

### Authorization at send time

`PushAudienceService` re-reads current rows when the worker runs. A push is
dropped (the in-app row stays) if any of these no longer holds:

- the row exists, is not soft-deleted (unlike, unfollow) and is unread;
- the recipient is active (not deleted, suspended or banned), has push on
  (`UserSettings.pushNotifs`) and the category on
  (`NotificationPreferences.push*`);
- the actor still exists and is active, and there is no block either way;
- the post/comment still exists (and is still the recipient's, for likes); the
  follow still exists; the invite is still PENDING and the activity not
  cancelled/ended; the joiner is still in the activity; the community still
  exists, the recipient can still review it, the joiner is still a member or
  the request still PENDING;
- for messages: the recipient is still a participant, not left, not muted, and
  still has unread messages in that conversation;
- for a removal: the recipient's `leftAt` is still that removal's time (a
  re-add, or a later removal that pushes on its own, drops it), and the
  conversation is a group.

Devices are read at send time too, by the recipient's user id, so a token that
moved to another account (account switch) is never sent the old account's
notifications.

### Grouping, dedupe, retries

- **Messages:** the first message of a burst is pushed at once (a Redis
  `SET NX PX 3000` per recipient and conversation opens the burst); the rest
  collapse into one delayed job per 3 s window with a fixed job id. The text
  uses the participant's own `unreadCount`, which messaging maintains and
  resets on read. On the device the push replaces the previous one for the
  same conversation (web `tag`, Android notification `tag`, FCM collapse key).
- **Viewing the conversation:** the open chat marks messages seen as they
  arrive (`conversation:mark_seen`), so by send time `unreadCount` is 0 and no
  push is sent. On the web, the service worker also shows nothing while a
  Meetifyy tab is focused and visible. A backgrounded app still gets pushes.
- **Like/unlike flapping:** the same actor doing the same thing to the same
  entity pushes at most once per hour (Redis `SET NX`). A different actor
  aggregating into the same row pushes again and replaces the tray entry ("A
  and 1 other liked your post.").
- **Duplicate enqueues** of the same row state collapse on the BullMQ job id
  (`n_<rowId>_<updatedAt>`); a removal on
  `gr_<recipient>_<conversation>_<leftAt>`.
- **Removal** shares the group's collapse key, so it replaces a pending "N new
  messages" for that group, and opens the chat, which shows that they are no
  longer a member.
- **Retries:** up to 5 attempts, exponential backoff. A per-device Redis marker
  means a retry caused by one device's 503 does not re-send to the devices that
  already accepted it.
- **Errors:** FCM `registration-token-not-registered`,
  `invalid-registration-token`, `mismatched-credential` and web 404/410 delete
  the device. 429/5xx/network retry. Auth/config errors (401/403, bad keys) are
  logged and never delete devices.

### Devices and sign-out

`PushDevice` rows are keyed to the **login** (`UserSession.familyId`), not the
session row (which rotates on every refresh). Every revocation path in
`UserSessionService` (sign out, sign out a device, sign out everywhere,
password change, refresh-token replay) deletes that login's devices. The client
also drops its local subscription/token on sign-out
(`AuthContext.clearLocalSession` → `forgetThisDevice`). Account deletion
cascades. At most 10 devices per user.

### Data model (migration 18, additive — safe to roll back the image)

- `enum PushPlatform { WEB, ANDROID }`
- `PushDevice` — `token` (web endpoint or FCM token, unique), `p256dh`, `auth`
  (web only), `familyId`, `appVersion`, `lastSeenAt`, `failureCount`, cascade on
  user delete.
- `NotificationType` + `COMMUNITY_JOIN`, `COMMUNITY_JOIN_REQUEST`
  (`ADD VALUE IF NOT EXISTS`, not used in the same migration).
- `NotificationPreferences` + `pushMessages`, `pushLikes`, `pushComments`,
  `pushMentions`, `pushFollows`, `pushActivities`, `pushCommunities` (default
  true). These are push-only: the existing flags still decide whether an
  in-app row is created at all; these decide only whether it also reaches a
  device. The account-wide switch is the existing `UserSettings.pushNotifs`
  (default false).

API routes: [BACKEND_AND_API.md](BACKEND_AND_API.md#push).

### Website client

- `frontend/src/platform/web/push.js` (Push API + `src/sw.js`), no Firebase.
- `src/shared/push/serviceWorkerPush.js` holds the worker's `push` /
  `notificationclick` logic: it shows the payload's text, stores only the
  validated Intent, and on click opens one of the site's own routes (focus +
  in-app navigation, or `openWindow` on this origin). A URL in a payload is
  ignored. `pushsubscriptionchange` re-subscribes and asks an open page to
  re-register.
- **The service worker exists only on production builds served from a
  production host** (`main.jsx` unregisters it on `dev.`/`staging.`/`preview.`
  hosts; non-production builds ship a tombstone). So web push cannot work on
  `dev.meetifyy.app`; Settings says "Not available on this version of the
  site." This policy was deliberately not changed (Cloudflare Access).
- iOS/iPadOS Safari: only for the site added to the Home Screen (16.4+).
  Settings explains this.

### Android client

- `@capacitor/push-notifications` 8.1.3 (Capacitor 8), FCM.
- `frontend/src/platform/capacitor/push.js`, created in `src/mobile/main.jsx`
  before the first render so a tap that cold-started the app is held and routed
  by `DeepLinkNavigator` once the router mounts (through the normal route
  guards; a signed-out tap returns there after sign-in).
- **Channels** (a permanent contract, never rename): `messages` (high),
  `social`, `activity`, `community`.
- **Icon:** `res/drawable/ic_stat_notify.xml`, the Meetifyy mark (the M with
  the Y inside) as a flat white silhouette, traced from the splash logo (it was
  a generic bell until 2026-10-26). Android draws only a small icon's alpha, so
  it cannot be the full-colour logo; it is tinted brand blue in the shade by
  `color` (#2563EB). The FCM payload names both (`android.notification.icon`
  and `.color`, `fcm.provider.ts`) and the manifest makes them the defaults, so
  background, killed and (if ever enabled) foreground notifications all use it.
  The name is a contract with every installed build: never rename it.
- `POST_NOTIFICATIONS` is declared; asked only from Settings or the opt-in card.
  After two denials Android stops showing the dialog; Settings then shows
  "Turned off for Meetifyy in your phone settings" with **Open settings**
  (`PushSupportPlugin.openSettings`).
- Foreground: no system banner; the open app already updates over its socket.
- `PushSupportPlugin.status()` reports whether the build carries a Firebase
  config. Without one the app never calls `register()` (which would throw) and
  Settings says "Not available in this version of the app."

### Settings and opt-in

Settings → Notifications → **Push Notifications** replaces the old "Browser
push alerts" checkbox (which saved a boolean and registered nothing). It shows
the device permission separately from the account switch: unavailable (with
the reason), blocked (where to change it), or a switch with per-category
switches under it. The OS prompt appears only when the switch is turned on.

The Notifications page shows one dismissible card ("Turn on" / "Not now") when
the permission is undecided and push is off. "Not now" is remembered on the
device; a denial is never re-asked.

### Push configuration

Backend (`backend/src/config/push.config.ts`, read via `env.ts`):

| Variable | Secret | Where |
|---|---|---|
| `PUSH_ENABLED` | no | Container App env. Default `false`. |
| `VAPID_PUBLIC_KEY` | no | Container App env (served to browsers by `/api/push/config`). |
| `VAPID_PRIVATE_KEY` | **yes** | Container App secret, e.g. `secretref:vapid-private-key`. |
| `VAPID_SUBJECT` | no | `mailto:` address or `https://` URL. |
| `FCM_PROJECT_ID` | no | Container App env. Must equal the service account's `project_id`. |
| `FCM_SERVICE_ACCOUNT_JSON` | **yes** | Container App secret, e.g. `secretref:fcm-service-account`. Raw JSON or base64. |

Boot validation: both VAPID keys together; subject must be mailto/https; the
service account must parse and match `FCM_PROJECT_ID`. The isolation guard
refuses production/staging with a Firebase project id or service account named
`dev`/`development`/`staging`, and development with one named
`prod`/`production`. **Name the projects `meetifyy-dev` and `meetifyy-prod`**
so that check means something. A VAPID key has no identity, so nothing can
check it: generate each environment's keypair separately and never copy one.

No `VITE_` variable is needed (the public key comes from the API). Never put
the private key or service account in a `VITE_` variable.

Each environment holds the private key and the service account as Container
App secrets `vapid-private-key` and `fcm-service-account`, referenced as
`VAPID_PRIVATE_KEY=secretref:vapid-private-key` and
`FCM_SERVICE_ACCOUNT_JSON=secretref:fcm-service-account`. Deploys change only
the image, so they keep them.

- **`setup-azure-prod.sh` sets them up** from `--env-file`, with or without
  `--sync-secrets`. The service account can be given as `FCM_SERVICE_ACCOUNT_FILE`
  (a path to the downloaded JSON) instead of pasting it.
- **It changes push only when that run supplies push credentials.** An env
  file with blank keys, like the example's, leaves the app's push settings as
  they are, `PUSH_ENABLED` included, because production's VAPID private key
  may exist only in Azure.
- **It checks everything before touching Azure:**
  - the two VAPID keys come together, at the right lengths;
  - the subject starts with `mailto:` or `https://`;
  - the service account parses, matches `FCM_PROJECT_ID`, and is not a
    `dev`/`staging` project.
- **Only the interactive path generates a VAPID pair.** A new pair means
  browsers subscribed with the old public key must subscribe again.
- **`setup-azure-dev.sh` does not set push up.** Dev's values were set by hand.

Android: `google-services.json` per build type, never one shared file:

```
frontend/android/app/src/debug/google-services.json    <- development Firebase project
frontend/android/app/src/release/google-services.json  <- production Firebase project
```

`app/build.gradle` applies the google-services plugin only when one of these
exists, with `missingGoogleServicesStrategy = 'WARN'`, so a variant without its
file still builds (without push). A file at `app/google-services.json` is
deliberately ignored (and git-ignored: it carries an API key that secret scans
flag).

### Setting push up for an environment

1. **Firebase project for development**, named `meetifyy-dev`
   (console.firebase.google.com → Add project). Analytics not needed.
2. In it, **add an Android app** with package name `app.meetifyy` (no SHA
   certificate is needed for FCM). Download `google-services.json` to
   `frontend/android/app/src/debug/google-services.json`.
3. Project settings → **Service accounts** → Generate new private key. That
   JSON is `FCM_SERVICE_ACCOUNT_JSON` for the **dev** API (a secret: never
   commit it, never paste it in chat). Set `FCM_PROJECT_ID=meetifyy-dev`. Check
   that "Firebase Cloud Messaging API (V1)" is enabled (Project settings →
   Cloud Messaging); it is by default.
4. **VAPID keypair**: `npx web-push generate-vapid-keys` (in `backend/`).
   Public → `VAPID_PUBLIC_KEY`, private → `VAPID_PRIVATE_KEY` (secret), and
   `VAPID_SUBJECT=mailto:<a monitored address>`.
5. For production repeat 1–4 **fresh** (`meetifyy-prod`,
   `src/release/google-services.json`, new VAPID keys). Never reuse a
   development value.
6. Migration 18 is applied by CI on merge (it was verified to build the whole
   folder from empty on PGlite).

Enabling on development: set `PUSH_ENABLED=true` and the four VAPID/FCM values
on the dev API (secrets as Container App secrets), then rebuild the dev APK
with `src/debug/google-services.json` in place (`npm run mobile:apk`) and
install it. An APK built before push existed cannot receive pushes: native
changes need a new APK. Website push needs a production build on a non-dev
host; to try it against development, run a production-mode build locally on
`localhost` pointed at the dev API with the dev VAPID public key served by that
API.

### Testing push

Automated (no network, no database):

```bash
cd backend && npx jest src/push src/communities/communities.join-notifications.spec.ts \
  src/auth/session/user-session.push-devices.spec.ts \
  src/realtime/realtime.message-push.spec.ts src/config/isolation.guard.spec.ts
cd frontend && npx vitest run src/shared/push src/platform/web/__tests__/push.test.js \
  src/platform/capacitor/__tests__/push.test.js \
  src/features/settings/panels/__tests__/pushNotificationsSettings.test.jsx
```

Manual, once configured:

- Android, signed in on the dev APK: Settings → Notifications → turn on →
  allow. From a second account trigger each category through the app (DM,
  group message, like, comment like, comment, reply, mention, activity invite,
  follow, community join, community join request, activity join). Check
  foreground (no banner, live UI updates), background (tray), killed (tray, tap
  cold-starts to the right screen), lock screen (contents hidden), a burst of
  messages (one notification, count updates), reading the chat (no push while
  open).
- Deny twice → Settings shows the blocked state and Open settings works.
- Sign out → trigger events → nothing arrives. Sign in as another account on
  the same phone → only that account's notifications.
- Delete the post / unlike / cancel the invite before the push is sent (within
  the 3 s message debounce, or with the worker paused) → nothing arrives, the
  in-app row is unaffected.
- Uninstall the app → next push gets UNREGISTERED → the `PushDevice` row is
  gone.
- Web (production-mode build, Chrome): same matrix with the tab visible
  (nothing shown, live UI), hidden, and closed; click opens the right page.

### References

- Push API: https://developer.mozilla.org/en-US/docs/Web/API/Push_API
- Notifications API: https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API
- showNotification: https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/showNotification
- W3C Push API: https://www.w3.org/TR/push-api/ ; Notifications: https://notifications.spec.whatwg.org/
- web.dev: https://web.dev/articles/push-notifications-web-push-protocol , https://web.dev/articles/push-notifications-subscribing-a-user , https://web.dev/articles/push-notifications-handling-messages , https://web.dev/articles/push-notifications-permissions-ux
- RFC 8030 (Web Push): https://www.rfc-editor.org/rfc/rfc8030 ; RFC 8291: https://www.rfc-editor.org/rfc/rfc8291 ; RFC 8292 (VAPID): https://www.rfc-editor.org/rfc/rfc8292
- web-push library: https://github.com/web-push-libs/web-push
- Safari / iOS web push: https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/ , https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers
- Capacitor Push Notifications: https://capacitorjs.com/docs/apis/push-notifications
- FCM receive on Android: https://firebase.google.com/docs/cloud-messaging/android/receive
- FCM message types: https://firebase.google.com/docs/cloud-messaging/customize-messages/set-message-type
- FCM HTTP v1: https://firebase.google.com/docs/cloud-messaging/send/v1-api ; error codes: https://firebase.google.com/docs/reference/fcm/rest/v1/ErrorCode
- FCM token management: https://firebase.google.com/docs/cloud-messaging/manage-tokens
- Admin SDK setup: https://firebase.google.com/docs/admin/setup
- Android notification permission: https://developer.android.com/develop/ui/views/notifications/notification-permission
- Android channels: https://developer.android.com/develop/ui/views/notifications/channels

---

## 3. Smaller documented behaviours

- **Community descriptions** are limited to 250 characters everywhere (create
  modal, admin modal, DTOs) via the shared `COMMUNITY_DESCRIPTION_MAX`
  (frontend `shared/constants/communityLimits.js`, backend
  `communities/community-limits.ts`). The DB column is unbounded text. (`bio`,
  200 on users, is the profile bio, a different field.)
- **Account enumeration:** `request-password-reset` always answers
  `{ sent: true }`.
- **Share links** are built on `VITE_SITE_URL` (`publicOrigin`), never on
  `window.location.origin` (which is `https://localhost` inside the app).
- **Link previews:** a shared `/post/:id` URL fetched by a social crawler is
  served the API's `/api/share/post/:id/preview` card through a Vercel rewrite
  keyed on the crawler's User-Agent; people get the app
  ([INFRASTRUCTURE.md](INFRASTRUCTURE.md#7-vercel-configuration)).
- **Share to Instagram Story** (installed app only, `InstagramStoriesPlugin`):
  Instagram requires a Meta (Facebook) App ID as `source_application`, provided
  at build time as `VITE_FACEBOOK_APP_ID` (public). Empty = the option is not
  offered.
- **Group invite links** use `/g/:code` (migration 34).
- **Ranked "For You" feed:** on by default; `FEATURE_FEED_RANKING=false` on the
  API reverts to the chronological feed with no app update. Affinity data
  (`UserAffinity`) is derived by the `ranking` worker and can be rebuilt.
- **Duplicate-safe creates:** posts, comments, conversations, group chats,
  communities, activities, discussion messages and support requests accept an
  `Idempotency-Key` ([BACKEND_AND_API.md](BACKEND_AND_API.md#7-idempotent-creates)).
- **Media limits** per kind: [BACKEND_AND_API.md](BACKEND_AND_API.md#5-uploads-and-media).
