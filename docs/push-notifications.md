# Push notifications

Browser push for the website, native push for the Android app. One backend
path delivers both. Push is **off** until a deployment is configured and
`PUSH_ENABLED=true` is set.

Status at the time of writing: the code, migration and tests exist. Nothing
has been delivered to a real browser or phone yet, because no VAPID keys,
Firebase project or `google-services.json` exist. See [Enabling it](#enabling-it-on-development).

---

## 1. How it works

```
action commits (like, comment, follow, message, join ...)
  -> NotificationsService.createNotification       existing: writes the in-app row, socket emit, unread count
       -> PushDispatcherService.enqueue*           new: synchronous, never awaited, never throws
            -> BullMQ queue "push" (Redis)         jobs hold ids only
                 -> PushProcessor                  re-checks everything at send time (PushAudienceService)
                      -> WebPushProvider  (VAPID, web-push)     -> browser push service -> sw.js
                      -> FcmProvider      (firebase-admin)      -> FCM -> Android system tray
```

Four layers, kept apart (spec 10E):

1. **Event + record.** Unchanged. Every category already funnels through
   `createNotification` after its action committed. The row is the durable
   record. There is no outbox: a push is derived, best-effort delivery, and a
   queue or provider outage never removes the row or fails the action.
2. **Delivery.** `PushDispatcherService` enqueues; `PushProcessor` sends one
   provider call per registered device.
3. **In-app.** Untouched. The socket emit happens before the push hand-off and
   does not depend on it.
4. **Read state, grouping, retries.** See below.

### Where each category comes from

| Category | Real event path | Push text |
|---|---|---|
| Direct message | `dm.controller` / `messages.controller` -> `createNotification(MESSAGE)`; socket `message:send` -> `realtime.gateway` | "You have a new message from [Name]." / "You have N new messages from [Name]." |
| Group message | `group-chats.controller`, socket `message:send` | title = group name, body "New message from [Name]" / "N new messages" |
| Post like | `posts.service` like path | "[Name] liked your post." ("[Name] and N others ...") |
| Comment like | `posts.service` comment-like path | "[Name] liked your comment." |
| Comment on your post | `posts.service` addComment | "[Name] commented on your post." |
| Reply | `posts.service` addComment (reply) | "[Name] replied to your comment." |
| Mention | `mentions.service` | "[Name] mentioned you in a post/comment." |
| Activity invite | `activities.service` -> `createActivityInviteNotifications` | "[Name] invited you to an activity." |
| Activity participant join | `activities.service.notifyHostOfJoin` (JOIN_REQUEST + ACTIVITY) | "[Name] joined your activity." |
| Follow | `users.service.followUser` -> BullMQ `follow-notification` | "[Name] started following you." |
| Community join (new) | `communities.service.joinCommunity`, public path | "[Name] joined your community." |
| Community join request (new) | `communities.service.joinCommunity`, private path | "[Name] requested to join your community." |

The two community notifications did not exist before; they are new
`NotificationType` values `COMMUNITY_JOIN` and `COMMUNITY_JOIN_REQUEST` (not
`JOIN_REQUEST`, which installed clients render as "joined the activity").
Recipients are the owner and moderators whose role may review requests
(`roleCan(..., 'REVIEW_JOIN_REQUESTS')`), capped at 25. Campus communities do
not notify on joins. A repeated "Join" on a request that is still pending does
not notify again. Clients that predate these types show the row's `body`
("Aarav joined Chess Club."), which reads correctly on its own.

SYSTEM and GROUP_INVITE rows stay in-app only. Instant Match messages are
never pushed (they have no Messages destination).

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
  (`UserSettings.pushNotifs`) and the category on (`NotificationPreferences.push*`);
- the actor still exists and is active, and there is no block either way;
- the post/comment still exists (and is still the recipient's, for likes);
  the follow still exists; the invite is still PENDING and the activity not
  cancelled/ended; the joiner is still in the activity; the community still
  exists, the recipient can still review it, the joiner is still a member or
  the request still PENDING;
- for messages: the recipient is still a participant, not left, not muted,
  and still has unread messages in that conversation.

Devices are read at send time too, by the recipient's user id, so a token
that moved to another account (account switch) is never sent the old
account's notifications.

### Grouping, dedupe, retries

- **Messages**: one delayed job per (recipient, conversation) with a fixed
  job id, so a burst within 3 s becomes one push. The text uses the
  participant's own `unreadCount`, which messaging already maintains and
  resets on read. On the device the push replaces the previous one for the
  same conversation (web `tag`, Android notification `tag`, FCM collapse key).
- **Viewing the conversation**: the open chat marks messages seen as they
  arrive (`conversation:mark_seen`), so by send time `unreadCount` is 0 and no
  push is sent. On the web, the service worker also shows nothing while a
  Meetifyy tab is focused and visible. A backgrounded app still gets pushes.
- **Like/unlike flapping**: the same actor doing the same thing to the same
  entity pushes at most once per hour (Redis `SET NX`). A different actor
  aggregating into the same row pushes again and replaces the tray entry
  ("A and 1 other liked your post.").
- **Duplicate enqueues** of the same row state collapse on the BullMQ job id
  (`n_<rowId>_<updatedAt>`).
- **Retries**: up to 5 attempts, exponential backoff. A per-device Redis
  marker means a retry caused by one device's 503 does not re-send to the
  devices that already accepted it.
- **Errors**: FCM `registration-token-not-registered`,
  `invalid-registration-token`, `mismatched-credential` and web 404/410 delete
  the device. 429/5xx/network retry. Auth/config errors (401/403, bad keys)
  are logged and never delete devices.

### Devices and sign-out

`PushDevice` rows are keyed to the **login** (`UserSession.familyId`), not the
session row (which rotates on every refresh). Every revocation path in
`UserSessionService` (sign out, sign out a device, sign out everywhere,
password change, refresh-token replay) deletes that login's devices. The
client also drops its local subscription/token on sign-out
(`AuthContext.clearLocalSession` -> `forgetThisDevice`). Account deletion
cascades. At most 10 devices per user.

---

## 2. Data model

Migration `backend/prisma/migrations/00000000000018_push_notifications`
(additive, safe to roll back the image):

- `enum PushPlatform { WEB, ANDROID }`
- `PushDevice` — `token` (web endpoint or FCM token, unique), `p256dh`,
  `auth` (web only), `familyId`, `appVersion`, `lastSeenAt`, `failureCount`,
  cascade on user delete.
- `NotificationType` + `COMMUNITY_JOIN`, `COMMUNITY_JOIN_REQUEST`
  (`ADD VALUE IF NOT EXISTS`, not used in the same migration).
- `NotificationPreferences` + `pushMessages`, `pushLikes`, `pushComments`,
  `pushMentions`, `pushFollows`, `pushActivities`, `pushCommunities`
  (default true). These are push-only: the existing flags still decide
  whether an in-app row is created at all, these only whether it also
  reaches a device. The account-wide switch is the existing
  `UserSettings.pushNotifs` (default false).

---

## 3. API (all `JwtGuard`, caller from the session only)

| Route | Purpose |
|---|---|
| `GET /api/push/config` | `{ enabled, webPushPublicKey, web, android }` |
| `PUT /api/push/devices` | register/refresh this device (`push.register` rate limit, 30/h) |
| `POST /api/push/devices/unregister` | remove the caller's own device by token |
| `GET /api/push/preferences` | `{ enabled, categories }` |
| `PATCH /api/push/preferences` | update master switch and/or categories (`push.preferences`, 60/h) |

Registration requires a live session (cookie session on web, `x-session-id`
in the app); a bare bearer token cannot register. Web endpoints must be https
on a known push service host (FCM, Mozilla autopush, Apple, WNS) because the
server POSTs to them (SSRF). No route takes a user id.

All routes are new and additive. Installed APKs that predate push never call
them, and no existing route or socket event changed shape.

---

## 4. Clients

### Website

- `frontend/src/platform/web/push.js` (Push API + `src/sw.js`), no Firebase.
- `src/shared/push/serviceWorkerPush.js` holds the worker's `push` /
  `notificationclick` logic: it shows the payload's text, stores only the
  validated Intent, and on click opens one of the site's own routes
  (focus + in-app navigation, or `openWindow` on this origin). A URL in a
  payload is ignored. `pushsubscriptionchange` re-subscribes and asks an open
  page to re-register.
- **The service worker exists only on production builds served from a
  production host** (main.jsx unregisters it on `dev.`/`staging.`/`preview.`
  hosts; non-production builds ship a tombstone). So **web push cannot work on
  dev.meetifyy.app**; Settings says "Not available on this version of the
  site." This policy was deliberately not changed (Cloudflare Access).
- iOS/iPadOS Safari: only for the site added to the Home Screen (16.4+).
  Settings explains this.

### Android app

- `@capacitor/push-notifications` 8.1.3 (Capacitor 8), FCM.
- `frontend/src/platform/capacitor/push.js`, created in `src/mobile/main.jsx`
  before the first render so a tap that cold-started the app is held and
  routed by `DeepLinkNavigator` once the router mounts (through the normal
  route guards; a signed-out tap returns there after sign-in).
- Channels (a permanent contract, never rename): `messages` (high),
  `social`, `activity`, `community`. Small icon `ic_stat_notify`.
- `POST_NOTIFICATIONS` declared; asked only from Settings or the opt-in card.
  After two denials Android stops showing the dialog; Settings then shows
  "Turned off for Meetifyy in your phone settings" with **Open settings**
  (`PushSupportPlugin.openSettings`).
- Foreground: no system banner; the open app already updates over its socket.
- `PushSupportPlugin.status()` reports whether the build carries a Firebase
  config. Without one the app never calls `register()` (which would throw)
  and Settings says "Not available in this version of the app."

### Settings and opt-in

Settings -> Notifications -> **Push Notifications** replaces the old
"Browser push alerts" checkbox (which saved a boolean and registered
nothing). It shows the device permission separately from the account switch:
unavailable (with the reason), blocked (where to change it), or a switch with
per-category switches under it. The OS prompt appears only when the switch is
turned on.

The Notifications page shows one dismissible card ("Turn on" / "Not now")
when the permission is undecided and push is off. "Not now" is remembered on
the device; a denial is never re-asked.

---

## 5. Configuration

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
refuses production/staging with a Firebase project id or service account
named `dev`/`development`/`staging`, and development with one named
`prod`/`production`. **Name the projects `meetifyy-dev` and `meetifyy-prod`**
so that check means something. A VAPID key has no identity, so nothing can
check it: generate each environment's keypair separately and never copy one.

No `VITE_` variable is needed (the public key comes from the API). Never put
the private key or service account in a `VITE_` variable.

Not done here, on purpose (CLAUDE.md §1, §6): the deploy workflows and
`setup-azure-*.sh` do not yet map these secrets. Adding them is a separate,
reviewed change: create the Container App secrets per environment, then add
`VAPID_PRIVATE_KEY=secretref:vapid-private-key` and
`FCM_SERVICE_ACCOUNT_JSON=secretref:fcm-service-account` to that
environment's env list.

Android: `google-services.json` per build type, never one shared file:

```
frontend/android/app/src/debug/google-services.json    <- development Firebase project
frontend/android/app/src/release/google-services.json  <- production Firebase project
```

`app/build.gradle` applies the google-services plugin only when one of
these exists, with `missingGoogleServicesStrategy = 'WARN'`, so a variant
without its file still builds (without push). A file at
`app/google-services.json` is deliberately ignored.

---

## 6. What you need to create

1. **Firebase project for development**, named `meetifyy-dev`
   (console.firebase.google.com -> Add project). Analytics not needed.
2. In it, **add an Android app** with package name `app.meetifyy` (no SHA
   certificate is needed for FCM). Download `google-services.json` and put it
   at `frontend/android/app/src/debug/google-services.json`.
3. Project settings -> **Service accounts** -> Generate new private key.
   That JSON is `FCM_SERVICE_ACCOUNT_JSON` for the **dev** API (a secret:
   never commit it, never paste it in chat). Set `FCM_PROJECT_ID=meetifyy-dev`.
   Check that "Firebase Cloud Messaging API (V1)" is enabled (Project
   settings -> Cloud Messaging); it is by default.
4. **VAPID keypair for development**: `npx web-push generate-vapid-keys`
   (run in `backend/`). Public -> `VAPID_PUBLIC_KEY`, private ->
   `VAPID_PRIVATE_KEY` (secret), and `VAPID_SUBJECT=mailto:<a monitored address>`.
5. Later, at production setup, repeat 1-4 **fresh** for production
   (`meetifyy-prod`, `src/release/google-services.json`, new VAPID keys).
   Never reuse a development value.
6. **Apply the migration** `00000000000018_push_notifications` through CI
   (`prisma migrate deploy` on merge). It was verified to build the whole
   folder from empty on a throwaway in-memory Postgres (PGlite); it has not
   been applied to any real database.

---

## 7. Enabling it on development

1. Merge so CI applies the migration to the dev database.
2. Set on the dev API: `PUSH_ENABLED=true`, the four VAPID/FCM values above
   (secrets as Container App secrets).
3. Rebuild the dev APK with `src/debug/google-services.json` in place
   (`npm run mobile:apk`) and install it. An APK built before push existed
   cannot receive pushes: native changes need a new APK.

Website push needs a production build on a non-dev host (see §4). To try it
against development, run a production-mode build locally on `localhost`
pointed at the dev API with the dev VAPID public key served by that API.

## 8. Testing end to end

Automated (no network, no database): backend `npx jest src/push
src/communities/communities.join-notifications.spec.ts
src/auth/session/user-session.push-devices.spec.ts
src/realtime/realtime.message-push.spec.ts src/config/isolation.guard.spec.ts`;
frontend `npx vitest run src/shared/push src/platform/web/__tests__/push.test.js
src/platform/capacitor/__tests__/push.test.js
src/features/settings/panels/__tests__/pushNotificationsSettings.test.jsx`.

Manual, once configured (Final verification B):

- Android, signed in on the dev APK: Settings -> Notifications -> turn on ->
  allow. From a second account trigger each category through the app (DM,
  group message, like, comment like, comment, reply, mention, activity
  invite, follow, community join, community join request, activity join).
  Check foreground (no banner, live UI updates), background (tray), killed
  (tray, tap cold-starts to the right screen), lock screen (contents hidden),
  a burst of messages (one notification, count updates), reading the chat
  (no push while open).
- Deny twice -> Settings shows the blocked state and Open settings works.
- Sign out -> trigger events -> nothing arrives. Sign in as another account
  on the same phone -> only that account's notifications.
- Delete the post / unlike / cancel the invite before the push is sent (within
  the 3 s message debounce, or with the worker paused) -> nothing arrives,
  the in-app row is unaffected.
- Uninstall the app -> next push gets UNREGISTERED -> the `PushDevice` row is
  gone.
- Web (production-mode build, Chrome): same matrix with the tab visible
  (nothing shown, live UI), hidden, and closed; click opens the right page.

## 9. References

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
