# First-year isolation

First-year students may interact only with other first-year students. The rule
is **symmetric**: a first-year and a non-first-year are invisible to each other,
whichever one initiates.

This is a **centralised policy**. Every surface asks the same service. Do not
re-derive it, and do not write `if (batchYear === 2026)` anywhere.

```
canUsersInteract(a, b)  ==  isFirstYear(a) === isFirstYear(b)
```

---

## 1. Where "first year" comes from

### Batch year, from the verified institutional address

A GLA University address encodes the joining batch in the local part,
immediately after the academic-programme identifier:

| Address | Programme | Batch |
|---|---|---|
| `sarthak.saini_cs25@gla.ac.in` | `cs` | 2025 |
| `shrangika.agnihotri_cs.h25@gla.ac.in` | `cs.h` | 2025 |
| `aman.usmani_cs.aiml25@gla.ac.in` | `cs.aiml` | 2025 |
| `aaradhya.rawat_cs.h24@gla.ac.in` | `cs.h` | 2024 |
| `dixita.mishra_cs24@gla.ac.in` | `cs` | 2024 |

The year is the digits that terminate the local part, and they only count when a
programme token — letters, optionally dotted — sits between the last underscore
and them. That anchor is what stops a digit in somebody's name being read as a
batch: `arjun.kumar26@gmail.com` parses to nothing.

Two-digit years expand into the 2000s (`26` → 2026). Four-digit tails
(`_cs2026`) are read as-is. Plus-tagged addresses (`x_cs25+cs26@…`) are refused
outright — the tag is the same mailbox at most providers, so honouring it would
let one verified address present two batches.

Parser: [`backend/src/common/student-year/batch-year.util.ts`](../backend/src/common/student-year/batch-year.util.ts).

### First-year status is derived, never stored

`User.batchYear` is a **server-derived cache** of
`extractBatchYearFromEmail(email)`. It is written at sign-up, re-derived on
every sign-in (self-healing), and backfilled by migration
`00000000000006_user_batch_year`. **No `/api/*` endpoint accepts it as input.**

First-year status is then computed per request:

```
isFirstYear(user) === (user.batchYear === currentAcademicYear())
```

There is deliberately **no `is_first_year` column**. That is what makes the year
transition free — see §6.

### Unresolved batches fail closed

An address the parser does not recognise yields `null`, and **`null` is not
first-year**. The opposite default would hand every malformed account a
first-year student's audience. An unresolved user sits with the non-first-year
population: subject to the ordinary rules, and invisible to first-years.

A stored `batchYear` outside the plausibility window (`currentYear - 20` to
`currentYear + 1`) is discarded and re-parsed — the column is only ever a cache,
so a value the parser would not produce today is stale data, not a fact.

---

## 2. The policy service

[`backend/src/common/student-year/student-year-policy.service.ts`](../backend/src/common/student-year/student-year-policy.service.ts)

Registered globally by `StudentYearPolicyModule`, so no feature module has to
import it.

### Prefer the query-layer helpers

| Method | Use for |
|---|---|
| `visibleUserWhere(viewerBatchYear)` | Prisma `where` fragment on `User` |
| `incompatibleUserWhere(viewerBatchYear)` | Its exact complement — for `none`, see below |
| `injectUserFilter(where, viewerBatchYear)` | **ANDs** the above into a `where` you are already building |
| `visibleRelationWhere(relation, viewerBatchYear)` | The same, lifted onto `creator` / `author` / `user` |
| `visibleUserSqlPredicate(alias, viewerBatchYear)` | Raw-SQL predicate, for the feed and ranking queries |

**Use `injectUserFilter`, not a spread.** The non-first-year branch is an `OR`,
and a `where` under construction very often already has one (a search clause, a
keyset cursor). Spreading silently overwrites whichever came first.

### Never filter a relation with `every`

This one cost a real bug and is invisible to both TypeScript and a unit test
with a stubbed Prisma.

Prisma compiles `participants: { every: P }` to `NOT EXISTS (row WHERE NOT P)`.
For a first-year viewer `P` is `"batchYear" = 2026`, and **`NOT (NULL = 2026)`
is `NULL`, not `TRUE`** — so the inner `EXISTS` matches nothing and `every`
reports "all participants are compatible". A DM whose partner had an
unresolved batch stayed in a first-year student's conversation list, with that
student's name, avatar and last message on it.

Use `none` over the **complement** instead:

```ts
participants: {
  none: {
    userId: { not: viewerId },
    user: policy.incompatibleUserWhere(viewerBatchYear),
  },
}
```

`none` compiles to `NOT EXISTS (row WHERE P)` — the predicate is never negated
— and both branches of `incompatibleUserWhere` spell out their `NULL` arm. The
same trap applies to any future `every` over a nullable column, not just this
one.

Positive filters (`{ creator: visibleUserWhere(...) }`, `injectUserFilter` on a
User query, the `OR` arms on notifications) are unaffected: they are never
negated, and `NULL = 2026` being `NULL` correctly *excludes* the row.

Pushing the rule into the database is not a performance nicety. Filtering after
`take` has been applied returns short pages, changes what "next page" means, and
writes unfiltered rows into a Redis entry on the way past.

### Runtime helpers, for guarding an action

| Method | Use for |
|---|---|
| `canUsersInteract(a, b)` | Two rows already in hand |
| `canIdsInteract(a, b, feature)` | Two ids; one batched, cached lookup |
| `getBatchYearFor(id)` / `getBatchYearMap(ids)` | Resolving batches — never one query per row |
| `assertCanInteract(actorId, targetIds, feature)` | Throws `403 FIRST_YEAR_RESTRICTED` |
| `getIncompatibleUserIds` / `filterInteractableUserIds` | Filtering a list already in memory |

Surface-named aliases (`canUserAppearInNewMessageModal`,
`canUserAppearInShareModal`, `canUserAppearInInviteModal`, `canCreateMessage`,
`canUsersMatch`, `canUserSeeUser`, `canUserSeeActivity`) all delegate to
`canUsersInteract`. They exist so a call site reads as what it guards and a
refusal can name the surface.

---

## 3. Where it is enforced

Every entry in this table is a place the policy is called. **If you add a
surface that returns users or content, add it here.**

### Messaging

| Path | File | How |
|---|---|---|
| Send (REST, socket, offline replay, attachments, replies) | `messages/core/messaging-core.service.ts` | `assertYearPolicyForParticipants` on the shared choke point |
| Existing-conversation gate | `messages/core/messaging-core.service.ts` | `assertVerifiedForConversation` |
| Start a DM | `messages/dm/dm.service.ts` → `startDM` | `assertCanInteract`, **before** the existing-thread branch |
| Jump to an existing DM | `messages/dm/dm.service.ts` → `lookupExistingDM` | Returns `null` for a restricted pair |
| DM list | `messages/dm/dm.service.ts` | Nested `participants.none` filter, in the query |
| Combined conversation list + share picker | `messages/messages.service.ts` → `getUserConversations` | Nested `participants.none`; `canSendMessages` mirrors it |
| Create conversation | `messages/messages.service.ts` | `assertCanInteract`, **before** the existing-thread branch |
| Create group | `messages/group-chats/group-chats.service.ts` | `assertCanInteract` over the founding roster |
| Add group member | both services | `assertCanInteract` against **every current member** |

An **old thread is never an exemption**. This is the deliberate difference from
the verification gate, which sits *after* the existing-conversation lookup so
history stays reachable. Isolation says the two people are not in each other's
world at all, so reviving a pre-policy thread is exactly the bypass being
closed.

### Discovery and recipient selectors

| Surface | File | How |
|---|---|---|
| `GET /users` (New Message modal source) | `users/users.service.ts` → `getAllUsers` | `injectUserFilter` |
| `GET /users/campus` (New Message modal source) | `getCampusUsers` | `injectUserFilter` |
| `GET /users/directory` | `getDirectory` | `injectUserFilter` |
| `GET /users/connections` (**every** share/invite picker) | `getConnections` | `injectUserFilter`; cache prefix `v3` |
| `GET /users/mention-search` | `getMentionSuggestions` | `injectUserFilter` |
| `GET /users/online-friends` | `getOnlineFriends` | `injectUserFilter` |
| `GET /users/recommendations` | `getFollowRecommendations` | SQL predicate inside the `eligible` CTE |
| Follower / following lists | `getFollowers` / `getFollowing` | SQL predicate, before `LIMIT/OFFSET` |
| Follow | `followUser` | SQL predicate inside `target_user` |
| Profile by username / by id | `getProfileByUsername` / `getUserById` | Emits `messagingRestricted` |
| Global search + typeahead | `search/search.service.ts` | `injectUserFilter`; cache prefix `v2` |
| Mention sanitiser | `mentions/mentions.service.ts` | `injectUserFilter` |

### Instant Match

| Stage | How |
|---|---|
| Candidate generation (`tryMatch`) | `visibleUserWhere` inside the queue query — an incompatible entry is never scored |
| Ranking explanation (`explainRankingFor`) | Same filter, so the explanation describes the pool the matcher used |
| "Searching now" | Same filter |
| `claimPair` | `canIdsInteract` guard on the **create** |
| `acceptSession` | `canIdsInteract` guard immediately before the conversation exists |

The Instant Match **card and UI were not modified.**

### Activities and posts

| Surface | File | How |
|---|---|---|
| Every activity list, feed, search, recommendation, bookmark | `activities/activity-authorization.service.ts` | `hostVisibilityWhere` ANDed into `discoveryWhere`, `sharedAudienceWhere` and `accessWhere` |
| Activity detail / join / attendees / discussion / realtime room | same | `hostIsVisibleTo` in `canView` / `canDiscover`, answering **404** |
| Activity invites | `activities/activities.service.ts` | `getIncompatibleUserIds`, reported per-invitee as `BLOCKED` |
| Post feed | `posts/posts.service.ts` → `getFeed` | SQL predicate on the author |
| Profile posts | `getUserPosts` | `canIdsInteract` on the author |

Activity visibility is judged on the **host**, like every other row is judged on
its owner.

### Notifications

`notifications/notifications.service.ts` guards **creation** (so the Redis
unread counter cannot drift) and filters both the list and the count through
`visibleActorWhere`. Those two must always agree — the file has been bitten
twice by hand-copied clauses drifting. `SYSTEM` notifications (null actor) are
always kept.

---

## 4. Caching

Any cache holding policy-filtered data must be **scoped by viewer** (or by
cohort) and its key version bumped when the meaning of an entry changes.

| Cache | Scope | Version bumped |
|---|---|---|
| `connections:` | viewer | `v2` → `v3` |
| `search:` / `search:suggestions:` | viewer | → `v2` |
| `user:conversations:` | viewer | → `v2` |
| `notifications:unread:` | viewer | → `v2` |
| `activities:feed:base:` | college **+ cohort** | audience tag extended |

The activity feed one is the interesting case: it is deliberately **shared
between viewers**. `sharedAudienceWhere` now filters on the viewer's batch, so
the audience tag had to grow an isolation bucket (`fy` / `nfy`) — without it the
first page a first-year student requested would be written under their college's
key and served to the whole campus. The tag carries the *bucket*, not the batch
year, so two seniors from different intakes still share a page.

---

## 5. Frontend

**Frontend restrictions are UX only.** Every rule is enforced independently by
the server.

[`frontend/src/shared/lib/studentYearPolicy.js`](../frontend/src/shared/lib/studentYearPolicy.js)

The client never parses addresses and never decides who is first-year. It reads
two server-supplied values:

- `currentUser.isFirstYearStudent` — from `/auth/sync`.
- `profile.messagingRestricted` — the server's answer for this exact
  viewer/target pair.

### The Message button

**It is never hidden and never disabled.** When
`profile.messagingRestricted` is true it renders with a lock glyph and opens
`MessagingRestrictedModal`. The locked branch returns *before*
`openDirectMessage`, so nothing is created and no request is sent.

Implemented in `features/profile/pages/ProfilePage.jsx` and
`shared/components/ui/UserSidebarCard.jsx`; styling is the `.secondaryBtnLocked`
block in `ProfilePage.module.css` (a dashed outline, not a `:disabled` style —
a greyed-out control explains nothing).

### The modal

[`frontend/src/shared/components/modals/MessagingRestrictedModal.jsx`](../frontend/src/shared/components/modals/MessagingRestrictedModal.jsx)

> **Messaging Restricted**
>
> Direct messaging between first-year students and students from other years is
> temporarily restricted to help keep first-year students safe.

Built on `ConfirmModal.module.css`, so it inherits the app's modal surface,
typography, spacing, colours, animation and dark theme. One action ("Got it"),
`role="dialog"` + `aria-modal` + `aria-labelledby`/`aria-describedby`, focus
moved to the dismiss button, Escape and backdrop both close. The copy names
neither cohort, so it reads identically in both directions.

The same string is `FIRST_YEAR_RESTRICTED_MESSAGE` on the server, so the dialog
and the API's own refusal say the same thing.

### Recipient lists

`filterCompatibleUsers` is applied in the New Message, Invite and Invite Friends
modals, and `sendableConversations` drops threads whose `canSendMessages` is
false (which covers share pickers). All are **second lines** — a row without the
marker is kept, so a narrow payload can never empty a picker.

---

## 6. The year transition

Nothing has to be done.

```
2026:  batchYear 2026 is first-year.  2026 ↔ 2026 allowed;  2026 ↔ 2025 blocked.
2027:  batchYear 2027 is first-year.  2026 ↔ 2025 allowed;  2026 ↔ 2027 blocked.
```

The same account changes cohort because `isFirstYearBatch` compares against
`getCurrentAcademicYear()` on **every call**. Nothing is cached that depends on
the year (the batch cache holds the batch, not the status), so New Message
lists, share and invite recipients, Message button lock states, feeds, match
eligibility and recommendations all move at midnight on 1 January with no
migration, no backfill job and no client deploy.

`ACADEMIC_YEAR` overrides the clock. It exists for tests and for a deliberate
operational correction — **not** as a place to hardcode a year.

---

## 7. Disabling and removing the feature

### Disable

```
FEATURE_FIRST_YEAR_ISOLATION=false
```

Every check honours it in one move: the `where` fragments become `{}`, the SQL
predicates become `TRUE`, and the asserts return. The two halves — query filters
and runtime guards — are switched by the same flag on purpose, so a deployment
cannot end up with one on and the other off.

### Remove

1. Delete `backend/src/common/student-year/` and its registration in
   `app.module.ts`.
2. Remove the call sites in §3. Every one is a one-line delegation.
3. Delete `frontend/src/shared/lib/studentYearPolicy.js`,
   `MessagingRestrictedModal.jsx`, the `.secondaryBtnLocked` CSS block, and the
   `messagingRestricted` branches in `ProfilePage.jsx` / `UserSidebarCard.jsx`.
4. `User.batchYear` may be left in place — it is an inert fact about the
   account, and dropping a column is not backward-compatible with the previous
   release (see `CLAUDE.md` §5).

---

## 8. Logging

Refusals log one line, at `debug`:

```
FIRST_YEAR_POLICY_BLOCKED viewerBatch=2026 targetBatch=2025 feature=messaging
```

`feature` is one of `messaging`, `new_message_modal`, `share_modal`,
`invite_modal`, `instant_match`, `recommendations`, `activity_visibility`,
`notifications`, `search`.

Batch years and a feature name only — no ids, no addresses, no message content.
`debug` rather than `warn` because, unlike a verification refusal, a blocked
cross-year interaction is the policy working normally and happens on every
ordinary browse; at `warn` it would drown the production log.

---

## 9. Tests

| File | Covers |
|---|---|
| `backend/.../student-year/batch-year.util.spec.ts` | Address parsing, including the real GLA patterns and every fail-closed case |
| `backend/.../student-year/student-year-policy.service.spec.ts` | The rule, the query fragments, caching, the kill switch |
| `backend/.../student-year/first-year-isolation.spec.ts` | The surfaces end to end — messaging, recipient selectors, activities, match, feeds, the year transition, edge cases |
| `frontend/.../lib/__tests__/studentYearPolicy.test.js` | The client helpers and their failure modes |
| `frontend/.../modals/__tests__/messagingRestrictedModal.test.jsx` | Copy, accessibility, single action, dismissal |

The backend surface tests assert on the **`where` clause**, not the returned
array. That distinction is the point: a service that fetched a page and filtered
it in JavaScript would satisfy an assertion on the result and still be wrong.
