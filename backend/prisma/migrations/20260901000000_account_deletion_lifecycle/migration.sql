-- Account-deletion lifecycle: 30-day soft-deletion / recovery window.
--
-- Requesting deletion no longer anonymizes the row. It stamps `deletedAt`
-- (which every existing user-facing query already filters on, so the account
-- disappears from search, profiles, suggestions and follow lists the moment
-- it is requested) and moves `accountStatus` to PENDING_DELETION. The row keeps
-- every original field, so recovery is a pure state transition with no data to
-- reconstruct. The purge worker performs the irreversible anonymization only
-- once `scheduledPurgeAt` has passed.
--
-- Purely additive: new enum value, new nullable columns, one new index. No
-- existing column is altered and no data is rewritten.

ALTER TYPE "AccountStatus" ADD VALUE IF NOT EXISTS 'PENDING_DELETION';

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "deletionRequestedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "scheduledPurgeAt"    TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "purgeStartedAt"      TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "purgeCompletedAt"    TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "purgeAttempts"       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "purgeLastError"      TEXT;

-- Drives the worker sweep: WHERE "accountStatus" = 'PENDING_DELETION'
--                          AND "scheduledPurgeAt" <= now()
CREATE INDEX IF NOT EXISTS "User_accountStatus_scheduledPurgeAt_idx"
  ON "User" ("accountStatus", "scheduledPurgeAt");
