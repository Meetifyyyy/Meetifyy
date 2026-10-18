# Signup, Campus college verification, personal email

Status: in development (branch `development`). Not deployed to production.

## Concepts (kept separate)

| Concept | Where it lives | Proven by |
|---|---|---|
| Account login / primary email | Supabase auth email = `User.email` | Supabase signup OTP, or the personal-email change OTP |
| Live selfie + ID ("Account verification") | `User.verificationStatus`, `VerificationRequest` | Admin review |
| Verified college email + affiliation | `CollegeAffiliation` (new) | College-email OTP on the Campus page, or legacy backfill |
| Campus authorization | active `CollegeAffiliation` whose college is active/approved/not deleted | server only |

`User.collegeId` / `User.collegeEmail` remain as a **mirror** of the active
affiliation so the many existing `collegeId` queries keep working. Only the
affiliation service writes them. Sign-in no longer auto-links a college from the
login email's domain.

## Policy

### Selfie gate (`@VerifiedOnly`) — narrowed
Kept ONLY on:
- messaging: DM create/send/forward, group chat create/send/forward/member add, message send/forward, message-core eligibility checks
- creating posts (`POST` post create only)
- creating communities
- creating activities
- Instant Match (all socket events + `joinQueue`)

Removed from: like/unlike, comment and comment like, bookmark, vote, delete own post/comment,
follow/unfollow, joining/leaving communities and their requests, community admin actions on
an existing community, joining/leaving/bookmarking activities and invitations, discussion posts,
campus users/directory, campus events reads.

Campus routes (`/api/users/campus`, `/api/users/directory`, `/api/communities/campus`,
`/api/campus-events*`, `COLLEGE_ONLY`/`shareToCampus` activity reads) are gated by
**affiliation** instead (403 `{ code: 'campus_affiliation_required' }` on HTTP, empty list where
the endpoint already returned `[]` for ineligible users). Campus-event writes still additionally
require `isCampusRep`.

### Legacy users
Every pre-existing account signed up with an email on an approved college domain that
Supabase confirmed by OTP. The migration backfills one `CollegeAffiliation`
(`method = LEGACY_PRIMARY_EMAIL`) per user where ALL hold:
- `User.collegeId` not null, `deletedAt` null
- the domain of `User.email` maps (via `CollegeDomain`) to that same `collegeId` (status not considered: the domain was approved at signup time)
- the normalized email is not claimed by any other row in this backfill (duplicates are skipped and reported)

`auth.users.email_confirmed_at` is checked by the dry-run report (`scripts/college-affiliation-report.ts`);
the migration itself cannot read `auth` reliably across environments, so the report must show zero
unconfirmed rows before the production deploy. Selfie status is unchanged.

Rows not matching are left without an affiliation; they use the Campus page flow. Nothing is
deleted, no email is transferred.

### College email uniqueness
- normalized = NFKC, trim, lowercase, IDN domain to ASCII (`DomainValidatorService` rules);
  local part kept as typed lowercased (no dot/plus stripping: institutions differ).
- `CollegeAffiliation.emailNormalized` is `UNIQUE` across ALL rows including revoked ones,
  until released (see below). Checked before OTP send, rechecked inside the verify transaction;
  the unique index is the final arbiter (P2002 -> generic 409).
- Error never identifies the owner: `{ code: 'college_email_unavailable' }`.
- One affiliation per user (`userId` UNIQUE). Changing college email = verify a new one: the
  verify transaction updates the user's row in place (old address released).
- Release: user removes affiliation in Settings -> row deleted (address free). Account purge
  deletes the row (FK cascade + explicit delete in purge). Admin revocation sets `revokedAt` and
  keeps the address reserved (audit) until an admin deletes it.

### Personal email (new)
- New signups: the signup email is the primary email (personal or college). It never grants an
  affiliation, even on a college domain.
- Existing users (primary = their college email): Settings -> Email lets them add a personal
  email. OTP to the new address + current password -> server sets the Supabase auth email
  (`admin.updateUserById`, `email_confirm: true`) and `User.email`. The college address remains
  on the affiliation. After this they sign in with the personal email.
- `User.email` stays unique. A personal email equal to any affiliation email of another user is
  allowed as a login (brief §6), but it cannot be verified as a college email by this account.

### Gender (new)
`User.gender` nullable enum `Gender { MALE FEMALE NON_BINARY PREFER_NOT_TO_SAY }`. Required by the
new signup UI (sent in Supabase metadata `gender` and the profile PATCH), optional for the API
(old APKs don't send it).

### Profile completion modal
Shown to signed-in users when `profileCompletion.needsPersonalEmail || profileCompletion.needsGender`.
Dismissible ("Later") per session; never blocks the app.
`needsPersonalEmail` = user has an affiliation AND `User.email` normalized equals the affiliation email.

## Data model (migration `00000000000014_college_affiliation`, additive only)

```prisma
enum Gender { MALE FEMALE NON_BINARY PREFER_NOT_TO_SAY }
enum CollegeAffiliationMethod { LEGACY_PRIMARY_EMAIL CAMPUS_OTP }
// UserOtpPurpose += COLLEGE_EMAIL, PERSONAL_EMAIL

model User { gender Gender? ; collegeAffiliation CollegeAffiliation? }

model CollegeAffiliation {
  id              String   @id @default(uuid())
  userId          String   @unique
  collegeId       String
  email           String
  emailNormalized String   @unique
  method          CollegeAffiliationMethod
  verifiedAt      DateTime @default(now())
  revokedAt       DateTime?
  revokedReason   String?  @db.VarChar(300)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  user    User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  college College @relation(fields: [collegeId], references: [id])
  @@index([collegeId])
}

// UserOtp gains a nullable `target String?` (normalized address the code was sent to)
// and `collegeId String?` (selected college), so verify cannot be redirected to another
// address/college than the one the code went to.
```

## API (all under JwtGuard unless noted; additive)

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/academics/colleges` (public, exists) | — | adds `logoUrl` per college (additive) |
| GET | `/api/campus/affiliation` | — | `{ affiliation: null \| { collegeId, collegeName, logoUrl, email (masked), method, verifiedAt, active } , pending: null \| { collegeId, collegeName, emailMasked, expiresAt, resendAvailableAt } }` |
| POST | `/api/campus/affiliation/otp` | `{ collegeId, email }` | `{ sent: true, emailMasked, expiresAt, resendAvailableAt }`; errors: `invalid_college`, `domain_mismatch`, `college_email_unavailable`, `already_affiliated` (same address), `invalid_email` (malformed), `affiliation_revoked` (403, admin-revoked account), 429 |
| POST | `/api/campus/affiliation/verify` | `{ code }` | `{ affiliation }` (same shape as GET); errors `invalid_code`, `expired_code`, `too_many_attempts`, `college_email_unavailable`, plus `invalid_college` / `domain_mismatch` if the college or domain was disabled after the code was sent, `affiliation_revoked` |
| DELETE | `/api/campus/affiliation` | `{ password }` | `{ success: true }` — releases address, clears mirror; errors `invalid_password` (403), `affiliation_revoked` (403) |
| GET | `/api/account/email` | — | `{ email, collegeEmail, needsPersonalEmail }` |
| POST | `/api/account/email/otp` | `{ email }` | `{ sent: true, emailMasked, expiresAt, resendAvailableAt }`; errors `email_taken`, `same_email`, `invalid_email`, 429 |
| POST | `/api/account/email/verify` | `{ code, currentPassword }` (no `email`: the body is refused if it names one) | `{ email }`; errors `invalid_password` (403, code not burned), `invalid_code`, `expired_code`, `too_many_attempts`, `email_taken` (409) |

Admin (all behind `AdminJwtGuard`):

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/admin/colleges`, `/admin/colleges/:id` (exist) | — | each college gains `logoUrl: string \| null` (additive) |
| POST | `/admin/colleges/:id/logo` | multipart, field `file`: PNG / JPEG / WEBP, ≤ 2 MB | `{ logoUrl }`. **SVG is rejected (400)**: `/api/media/*` serves from the API's own origin with no SVG sanitizer, so an SVG logo would be stored XSS |
| DELETE | `/admin/colleges/:id/logo` | — | `{ success: true }` |
| GET | `/admin/users/:id` (exists) | — | gains `collegeAffiliation: null \| { collegeId, collegeName, email, method, verifiedAt, revokedAt, revokedReason }` (full address: admin view) |
| PATCH | `/admin/users/:id/college-affiliation/revoke` | `{ reason }` (required, ≤ 300 chars) | `{ collegeAffiliation }` (admin shape). Sets `revokedAt`, clears the mirror and `isCampusRep`; the address stays reserved; the user cannot re-verify or remove it |
| POST | `/admin/users/:id/reset-college` (exists) | — | now **deletes** the affiliation (releasing the address) together with the mirror; previously it cleared only the mirror |

Session / sync / profile user objects gain (additive): `gender`, `campusAffiliation`
(same shape as above or null), `profileCompletion: { needsPersonalEmail, needsGender }`.
`PATCH` profile accepts `gender`.

Rate limits reuse `UserOtpService` (10 min TTL, 5 attempts, 60 s cooldown, 5 sends/h per purpose,
30 verifies / 15 min per IP) plus the route policies `auth.otp.user` + `auth.otp.ip` on both send
endpoints (shared with the account-deletion codes) and `auth.verifypassword.user` on the two
password-checked endpoints. OTP emails use the existing email service (template
`email-address-otp.tsx`, security sender).

Implementation notes (backend):
- `UserOtpService.verifyBound` consumes the code atomically and returns its bound `target` /
  `collegeId`; the caller applies those, never a request value. `verify` (account deletion) is
  unchanged and still answers every failure as `OTP_INVALID`.
- Campus gating: `CampusAccessService` (`src/common/campus/`). One unique-index lookup per request,
  deliberately uncached. The activity viewer context (`COLLEGE_ONLY` slice) and campus-event writes
  take the college from the affiliation, not from `User.collegeId`.
- `GET /api/communities/campus` keeps answering `[]` without an affiliation (as it did without a
  campus); `/api/users/campus`, `/api/users/directory`, `/api/campus-events*` answer 403
  `campus_affiliation_required`.
- Group chats: joining is messaging. `@VerifiedOnly` is on `addMember`, `acceptJoinRequest` and
  `POST :id/join` / `POST :id/request` on BOTH controllers (`/api/group-chats` and `/api/messages`).
  The service re-checks too: `joinGroupByInvite` refuses an ineligible joiner (also for approval
  groups, so no un-approvable request is created), and `acceptGroupJoinRequest` refuses an
  ineligible REQUESTER with 403 `{ code: 'JOIN_REQUEST_INELIGIBLE' }` and deletes that request.
  `GET :id/invite` stays readable and gains `requiresVerification: boolean` (additive).
  Info edits, role changes, member removal and declining requests are not gated.
- Changing the campus (verifying an address of a different college) clears `isCampusRep`.
- `check-email` without `collegeId` checks only `User.email` (a login may equal someone else's
  college email) and returns `collegeId`/`collegeName` as a hint when the domain is approved,
  `collegeId: null` otherwise.
- Campus listings (`/api/users/campus`, `/api/users/directory`) list only users with an active
  (not revoked) affiliation to that college, filtered through the relation; the `User.collegeId`
  mirror alone (legacy rows the backfill skipped) is not enough. The mirror is never nulled.
- Same-college *ranking boosts* also use the ACTIVE affiliation on both sides, not the mirror:
  people search (and campus-only community visibility in search), follow recommendations (campus
  arm + sameCollege/sameBranch/sameBatch), the people pickers (campus fill + boost, one batched
  affiliation lookup), the ranked home feed author boost, community recommendations
  (`campusMemberCount`) and trending (viewer campus + campus authors; cache key bumped to
  `trending:v2:*`). Raw-SQL helpers: `src/common/campus/campus-affiliation.sql.ts`. Search's
  viewer context (`resolveViewer`, also used for COLLEGE_ONLY activity discovery) reads the
  affiliation in the same query. Displayed college names on result cards still come from the mirror.
- `AuthService.verifyPassword` (verify-password, change-password, affiliation DELETE, email verify)
  checks the password against the CURRENT auth email (Supabase admin `getUserById`, then
  `User.email`, then the token claim), so a token issued before a personal-email change still works.
- After a personal-email change a security notice ("sign-in email changed to j***@gmail.com; if
  this wasn't you, contact support") is queued to the OLD address, fire-and-forget (template
  `signin-email-changed.tsx`).
- `PATCH /api/users/me` no longer writes `User.email` at all (the old placeholder "auto-heal" and the
  body-`email` fallback are gone). The only writers of an existing account's `User.email` / auth email
  are `POST /api/account/email/verify` and the account purge's anonymization.

Socket: on affiliation change emit `user:campus_changed` `{ campusAffiliation }` to the user;
clients drop campus query caches (same list as `VERIFICATION_GATED_QUERY_KEYS`).

## Old installed apps

Old APKs still send college-only signups and read `verificationStatus`. Nothing they call is
removed or renamed; `check-email` keeps its reason strings (it now returns `isValid: true` for
non-college domains on signup, with `collegeId: null`).

What an old-APK user sees (checked against the committed pre-change frontend):

| User | Old APK behaviour |
|---|---|
| Selfie-verified, has an affiliation (legacy backfill) | Unchanged: Campus works. |
| Selfie-verified, no affiliation (backfill skipped them, or a new signup) | Campus gate is open client-side (it gates on `verificationStatus`); `/api/users/campus`, `/directory`, `/api/campus-events*` answer 403 and the pages render their empty states ("No students found", no events); `/api/communities/campus` returns `[]`. The old APK has no Campus-page college-email flow, so they cannot fix this until they update. |
| Not selfie-verified, has an affiliation | Old client keeps Campus behind its "verify your student ID" gate although the server would allow it. Conservative, not a leak. |
| Not selfie-verified | Old client still blocks likes/comments/follows/joins client-side that the server now allows (conservative). Joining a group by invite now answers 403 from the server (`@VerifiedOnly`); the old invite screen shows its generic error. |
| New signup on an old APK | Signs up with a college address as before, but no longer gets a campus from the domain: they need the new build to verify on the Campus page. |

The session payload cannot paper over this: the only field old clients read for the Campus gate is
`verificationStatus`, which also drives messaging; faking it would mislabel selfie status. The new
fields (`campusAffiliation`, `profileCompletion`, `gender`) are additive and ignored by old clients.

**Release step:** when the new build ships, set `MOBILE_LATEST_VERSION_ANDROID` (and `_IOS` if
applicable) to its version so old installs get the update *nudge*. Do NOT raise
`MOBILE_MIN_VERSION_*` for this (nothing above is broken enough to force-update), and do not change
the defaults in `app.config.ts`. These are set per environment in the Container App config, by the
owner (CLAUDE.md §1).

## Help and legal copy

Migration `00000000000015_open_signup_copy` (content only) rewrites the help articles that described
college-only signup (create account, account verification, profile info, Instant Match, campus
events, can't log in, verification email) and adds `how-do-i-join-my-colleges-campus` and
`adding-a-personal-email`. It only touches rows nobody edited (`updatedAt = createdAt`); admin-edited
articles must be reviewed by hand. Rollback is not needed (no schema change).

Legal texts are NOT in this migration: since commit 37f61b79 they are static frontend content
(`frontend/src/features/info/pages/legalDocuments.js`) and there is no admin publish flow, so a DRAFT
`LegalDocumentVersion` row could never be published. The Privacy Policy and Terms there still say a
college email is required to sign up, and the Privacy Policy has no section on the selfie/ID images.

## Deployment / rollback
See the "Deployment" section of the final report (kept in the PR description).

Before production: run `npx ts-node scripts/college-affiliation-report.ts` (read-only; runs in a
`READ ONLY` transaction) against a copy/replica and confirm `unconfirmed-email` is 0.

### Rollback SQL

The migration is additive, so the previous image runs against it unchanged; rolling back the image
does NOT require this. Only to remove the schema entirely (after the image has been rolled back):

```sql
BEGIN;
DROP TABLE IF EXISTS "CollegeAffiliation";
DROP TYPE IF EXISTS "CollegeAffiliationMethod";
ALTER TABLE "User" DROP COLUMN IF EXISTS "gender";
DROP TYPE IF EXISTS "Gender";
-- Codes for the two new purposes must go before the enum can shrink.
DELETE FROM "UserOtp" WHERE "purpose"::text IN ('COLLEGE_EMAIL', 'PERSONAL_EMAIL');
ALTER TABLE "UserOtp" DROP COLUMN IF EXISTS "target";
ALTER TABLE "UserOtp" DROP COLUMN IF EXISTS "collegeId";
-- Postgres cannot drop an enum value; recreate the type.
ALTER TYPE "UserOtpPurpose" RENAME TO "UserOtpPurpose_old";
CREATE TYPE "UserOtpPurpose" AS ENUM ('ACCOUNT_DELETION', 'ACCOUNT_RECOVERY');
ALTER TABLE "UserOtp" ALTER COLUMN "purpose" TYPE "UserOtpPurpose"
  USING "purpose"::text::"UserOtpPurpose";
DROP TYPE "UserOtpPurpose_old";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '00000000000014_college_affiliation';
COMMIT;
```

Notes: `User.collegeEmail` values filled by the backfill's mirror step (only where it was NULL) are
left in place; personal-email changes already applied (new `User.email` + auth email) are not
reverted by this; after verifying a college email, `User.collegeId` / `collegeEmail` reflect it and
remain so. Hand-running this on production is a CI/owner decision (CLAUDE.md §1).
