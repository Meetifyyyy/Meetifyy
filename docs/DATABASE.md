# Database

Postgres on Supabase (one project per environment), accessed only by the
backend through Prisma. Clients never talk to the database.

Related: [INFRASTRUCTURE.md](INFRASTRUCTURE.md) (deploy pipeline, environments),
[BACKEND_AND_API.md](BACKEND_AND_API.md), [SECURITY.md](SECURITY.md).

---

## 1. Stack and connection

- **Prisma 6** (`backend/prisma/schema.prisma`) with the **`@prisma/adapter-pg`
  driver adapter** (`prisma.service.ts`): queries run through node-postgres,
  not Prisma's Rust query engine. Pool size comes from `connection_limit`,
  which the app's own `buildPool()` reads to size the pg Pool.
- The schema currently defines 70 models and 50 enums.
- `PrismaService` warms the pool and pings it every 25 s (`pingPool`, excluded
  from tracing). It disconnects in `onApplicationShutdown`, **after** BullMQ
  workers close in `beforeApplicationShutdown` (`DrainingWorkerHost`), so jobs
  never run against a closed database. A query issued after the database has
  closed throws `DatabaseUnavailableError` instead of resolving to `undefined`,
  and transient connection drops (P1001/P1002/P1008/P1017, "Connection
  terminated unexpectedly", Supavisor "Failed to connect to database") are
  retried twice (`connection-retry.middleware.ts`).

### Connection strings

Both `DATABASE_URL` and `DIRECT_URL` point at the Supabase **pooler**:

| Variable | Host | Mode | Used by |
|---|---|---|---|
| `DATABASE_URL` | `aws-0-<region>.pooler.supabase.com:6543` | transaction | runtime |
| `DIRECT_URL` | `aws-0-<region>.pooler.supabase.com:5432` | session | migrations |

- **`DIRECT_URL` uses the pooler, not the direct host.** `db.<ref>.supabase.co`
  is **IPv6-only**, which Azure Container Apps cannot reach.
- **Do not add `pgbouncer=true`.** That flag is specific to Prisma's Rust query
  engine. node-postgres does not use named prepared statements by default, so
  transaction pooling is already safe.
- **Do not add `sslmode=require`.** The installed `pg` treats `require` as
  `verify-full`, which **fails on Supabase's certificate chain** and would break
  production at boot. Both URLs connect correctly without it.
- **Percent-encode the password.** A raw `@` in the password makes the URI
  ambiguous; Prisma rejects it (`P1013`) and lenient parsers split on the last
  `@`. Write `@` as `%40` (and encode other reserved characters).

---

## 2. Migrations

The `backend/prisma/migrations/` folder is the deployable unit. The deploy
workflows run `prisma migrate deploy` as a pre-deploy Container App Job and
apply exactly those files, in order ([INFRASTRUCTURE.md](INFRASTRUCTURE.md#4-cicd-and-the-deploy-pipeline)).

### Creating one

When you change `schema.prisma`:

```bash
cd backend && npx prisma migrate dev --name describe_your_change
```

then **commit `schema.prisma` and the generated migration folder together**. A
schema change without its migration never reaches production, and the app
boots expecting a column that is not there.

`migrate dev` is local-only and is the sharp one: against a drifted database it
offers to **reset (wipe) it**. Run it only against your own throwaway database.
The shared development database has been wiped this way more than once, and the
free plan has no backups — ask before running any Prisma command that touches
a real database (never shadow/reset/push against a real URL).

| Command | Use |
|---|---|
| `npx prisma migrate dev --name <x>` | Local only. Creates + applies a migration. |
| `npx prisma migrate deploy` | Deployed environments (CI). Applies pending migrations; never drops. |
| `npx prisma migrate status` | Check whether the DB matches migration history. |
| `npx prisma migrate resolve --applied <x>` | Mark a hand-applied migration as done. |

### Never `prisma db push`

It force-matches the database to `schema.prisma` and **drops whatever does not
match** — including columns holding real user data — with no migration to
review and no rollback. It also records nothing, so `_prisma_migrations` stops
describing the real database.

This repository has already been bitten: an earlier history shipped 44
migrations that could not build the database from empty. 25 of 56 models at the
time — including `ActivityInvitation`, `SupportTicket`, `CampusEvent`,
`MatchSession` — had no `CREATE TABLE` anywhere; they existed in development
only because `db push` had put them there, and the migration files were
retro-fitted around a database that already had the changes. The first
genuinely fresh deploy (production) failed on a migration that altered a table
nothing had created. Migration files had also sat unapplied on disk while the
database quietly had their changes, and reconciling the two meant comparing
databases column by column. The history was rebuilt into the current folder,
starting at `00000000000000_init`.

### Rules

- **The folder must build the database from empty.** If a migration alters a
  table, an earlier migration in the same folder must create it. If it needs an
  extension, it declares `CREATE EXTENSION IF NOT EXISTS`.
- **Every migration must be backward-compatible with the previous release**,
  because a rollback reverts the image but not the schema. Prefer additive
  changes.
- **Never `CREATE INDEX CONCURRENTLY` in a migration.** Prisma wraps each file
  in a transaction and Postgres rejects it there (SQLSTATE 25001). The failure
  is recorded, and P3009 then blocks every later migration until someone runs
  `migrate resolve` by hand.
- **Keep the folder clean.** One directory per migration, no stray files, no
  `.bak`, and no edits to a migration that has already been applied anywhere —
  editing one changes its checksum and breaks every environment that has it.
  (Numbers 19 and 28 do not exist in the folder; do not reuse them.)
- **`ALTER TYPE … ADD VALUE`** must not be used by the same migration that adds
  it (Postgres restriction); see migration 18.
- **Let CI create the schema.** The production database must be empty before
  its first deploy. Building tables by hand — via MCP or SQL — leaves
  `_prisma_migrations` empty, so the first `migrate deploy` fails on "already
  exists" and leaves someone hand-baselining migration history on a live
  database.
- **Verify before merging** anything that adds a migration — apply the whole
  folder into a scratch schema, then drop it:

  ```sql
  CREATE SCHEMA migration_test;  -- apply every migration in order, then
  DROP SCHEMA migration_test CASCADE;
  ```

  A scratch schema makes this safe to check against any database. Without a
  server, the PGlite rig below does the same (migration 18 was verified that
  way).
- **If the history is ever squashed**, the generated `_init` covers only what
  `schema.prisma` can express. Trigram/GIN indexes, extensions, functions,
  triggers (such as the `auth.users` email guard) and seed data must be carried
  forward by hand — they are invisible to `migrate diff` and vanish silently.

### Current migrations

| # | Name | Notes |
|---|---|---|
| 00 | `init` | Baseline schema. |
| 01 | `search_and_perf_indexes` | Search (trigram/GIN) and performance indexes. |
| 02 | `seed_content` | Help-centre content, seeded as a migration (the public page reads it; every statement `ON CONFLICT`). |
| 03 | `error_log` | `ErrorLog`: append-only error records for the admin Error Logs view. |
| 04 | `campus_event_idempotency` | |
| 05 | `match_decline_attribution` | |
| 06 | `user_batch_year` | Its comment cites `docs/first-year-isolation.md`, which does not exist in the repository. |
| 07 | `legal_documents` | |
| 08 | `user_sessions` | `UserSession` (revocable sessions; see [SECURITY.md](SECURITY.md#2-sessions)). |
| 09 | `support_request_type` | |
| 10 | `help_content_accuracy` | Help-centre content. |
| 11 | `user_affinity` | `UserAffinity`: per-pair interaction strength for the For You feed, written only by the ranking worker; derived, can be emptied and rebuilt. |
| 12 | `help_remove_first_year_article` | |
| 13 | `backfill_post_hashtags` | |
| 14 | `college_affiliation` | `CollegeAffiliation`, `Gender`, OTP binding; legacy backfill. [Rollback SQL](#6-rollback-sql-for-migration-14). |
| 15 | `open_signup_copy` | Help-centre copy for open signup (content only). |
| 16 | `publish_open_signup_legal` | Legal copy for open signup and Campus college-email verification. |
| 17 | `profile_prompt_snooze` | |
| 18 | `push_notifications` | `PushDevice`, `PushPlatform`, push preference columns, `COMMUNITY_JOIN*` notification types. |
| 20 | `verification_live_method` | |
| 21 | `privacy_policy_live_verification` | |
| 22 | `show_college_on_profile` | |
| 23 | `unique_client_message_id` | |
| 24 | `drop_prefix_duplicate_indexes` | |
| 25 | `drop_unused_notification_index` | |
| 26 | `media_placeholder` | |
| 27 | `confessions` | |
| 29 | `email_change_security` | `ReauthGrant`, `EmailChangeEvent`, `AuthEmailChangeIntent`, the `auth.users` guard trigger. |
| 30 | `lock_down_data_api` | RLS on, `anon`/`authenticated` revoked. [Data API](#3-supabase-data-api-postgrest). |
| 31 | `confession_reactions` | |
| 32 | `legal_support_email` | |
| 33 | `left_group_snapshot` | |
| 34 | `group_invite_links` | |
| 35 | `poll_option_position` | |
| 36 | `legal_rewrite_v1` | |
| 37 | `privacy_policy_deletion_steps` | |

All of the above are on `main` (released). Notes without detail mean the
migration's name is its documentation; read the SQL.

---

## 3. Supabase Data API (PostgREST)

Nothing in this app uses the Data API: the backend reads and writes through
Prisma, and clients only talk to the backend. Supabase still serves every
table in `public` over REST to anyone holding the anon key, which ships in
every browser bundle. Until migration 30 (`lock_down_data_api`) that meant
every row, `User` and the `ConfessionProfile` account-to-handle mapping
included, could be read **and written** by anyone.

Migration 30 enables RLS (no policies) on every table, revokes `anon` and
`authenticated` from tables and sequences, and stops new tables inheriting
those grants. Prisma connects as the tables' owner, which RLS does not apply
to.

To check a project, with its anon key: `GET /rest/v1/User?select=id&limit=0`
with `Prefer: count=exact`. A `content-range` of `*/0` (or a permission error)
is correct; any other count means the tables are exposed. Never add a policy
or grant for `anon`/`authenticated` without a written reason in this section.

---

## 4. Notable models and invariants

| Model | Invariant |
|---|---|
| `User` | Created by `syncProfile` for a verified Supabase account. `User.email` is unique and mirrors the Supabase auth email; only the account-email flow and the account purge write it for an existing account. `User.collegeId`/`collegeEmail` are a **mirror** of the active `CollegeAffiliation`, written only by `CampusAffiliationService`. |
| `UserSession` | Foreign key to `User` — **profile before session**: any route that calls `sessions.issue` must run `syncProfile` first ([SECURITY.md](SECURITY.md#4-auth-invariants)). Refresh rotates; `familyId` identifies a login across rotations. |
| `CollegeAffiliation` | One per user (`userId` UNIQUE); `emailNormalized` UNIQUE across all rows including revoked ones, until released. See [FEATURES_AND_FLOWS.md](FEATURES_AND_FLOWS.md#1-signup-campus-and-college-email). |
| `UserOtp` | Purposes `ACCOUNT_DELETION`, `ACCOUNT_RECOVERY`, `COLLEGE_EMAIL`, `PERSONAL_EMAIL`; nullable `target` and `collegeId` bind a code to the address/college it was sent for. |
| `ReauthGrant`, `EmailChangeEvent`, `AuthEmailChangeIntent` | Email-change security ([SECURITY.md](SECURITY.md#8-email-change-security)). |
| `PushDevice` | Keyed to the login (`UserSession.familyId`), cascades on user delete; at most 10 per user. |
| `Media` | Rows are registered at **presign** time, so a row does not prove the object exists in R2. |

The affiliation data model as introduced by migration 14 (additive only;
`schema.prisma` is authoritative for the current shape):

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

Raw-SQL helpers that encode campus rules live in
`backend/src/common/campus/campus-affiliation.sql.ts`. `parentId` on `Comment`
is unindexed; reply queries filter by `postId` to use `(postId, createdAt)`.

### Useful checks

Accounts verified at Supabase with no `User` row (a half-created signup):

```sql
select a.id, a.created_at from auth.users a
where a.email_confirmed_at is not null
  and not exists (select 1 from public."User" u where u.id = a.id::text);
```

The auth email guard trigger (after migration 29, in each project):

```sql
SELECT tgname FROM pg_trigger
WHERE tgrelid = 'auth.users'::regclass
  AND tgname = 'meetifyy_guard_auth_email_change';
```

---

## 5. Testing against a real Postgres

Backend database tests run against real Postgres with no server, using PGlite
over its socket server. Use `connection_limit=1` for single-connection servers
such as PGlite. Database-backed specs (for example
`account-security/email-change.db.spec.ts`) create a Supabase-shaped
`auth.users` (`id uuid, email text, email_change text, last_sign_in_at`) plus
the `anon`, `authenticated` and `supabase_auth_admin` roles, and run only when
`DATABASE_URL` and the spec's own variable (e.g.
`EMAIL_SECURITY_TEST_DATABASE_URL`) are the same **localhost** URL. Never point
them at a shared database.

---

## 6. Rollback SQL for migration 14

Migration `00000000000014_college_affiliation` is additive, so the previous
image runs against it unchanged; rolling back the image does **not** require
this. Only to remove the schema entirely (after the image has been rolled
back):

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

Notes: `User.collegeEmail` values filled by the backfill's mirror step (only
where it was NULL) are left in place; personal-email changes already applied
(new `User.email` + auth email) are not reverted by this; after verifying a
college email, `User.collegeId` / `collegeEmail` reflect it and remain so.
Hand-running any of this on production is a
CI/owner decision — never an agent's.

Before the migration-14 production deploy, the read-only dry-run report
(`npx ts-node scripts/college-affiliation-report.ts`, run in a `READ ONLY`
transaction against a copy/replica) had to show `unconfirmed-email` = 0.
