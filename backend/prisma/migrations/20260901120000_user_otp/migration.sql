-- One-time codes for the account-deletion lifecycle.
--
-- Purely additive: one new enum, one new table. Nothing existing is altered.
--
-- The (userId, purpose) unique constraint is load-bearing, not an optimisation:
-- it is what makes "issuing a new code invalidates the previous one" a property
-- of the schema rather than a rule every call site has to remember. The service
-- upserts on it, so a resend overwrites the live row and the old code stops
-- working the moment the new one is minted.

CREATE TYPE "UserOtpPurpose" AS ENUM ('ACCOUNT_DELETION', 'ACCOUNT_RECOVERY');

CREATE TABLE "UserOtp" (
    "id"         TEXT NOT NULL,
    "userId"     TEXT NOT NULL,
    "purpose"    "UserOtpPurpose" NOT NULL,
    -- HMAC-SHA256 keyed with a server secret, never a bare digest: a six-digit
    -- code has only a million possibilities, so an unkeyed hash is reversible
    -- by anyone who obtains this table.
    "codeHash"   TEXT NOT NULL,
    "attempts"   INTEGER NOT NULL DEFAULT 0,
    "expiresAt"  TIMESTAMP(3) NOT NULL,
    -- Stamped the moment a code is accepted, so a correct code cannot be replayed.
    "consumedAt" TIMESTAMP(3),
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestIp"  TEXT,

    CONSTRAINT "UserOtp_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserOtp_userId_purpose_key" ON "UserOtp" ("userId", "purpose");
CREATE INDEX "UserOtp_expiresAt_idx" ON "UserOtp" ("expiresAt");

ALTER TABLE "UserOtp"
  ADD CONSTRAINT "UserOtp_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
