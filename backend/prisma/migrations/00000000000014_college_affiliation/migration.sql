-- College affiliation, gender, personal-email OTPs.
--
-- See docs/college-affiliation.md. Additive only, so the previous release keeps
-- working against this schema after a rollback of the image:
--   * new enums and one new table the previous release never reads,
--   * two new enum values the previous release never writes,
--   * nullable columns on "User" and "UserOtp" the previous release ignores.
-- Nothing existing is altered, renamed, dropped or rewritten. User.collegeId and
-- User.collegeEmail are left exactly as they are (they become a mirror of the
-- affiliation from the new release onward).
--
-- The rollback SQL lives in docs/college-affiliation.md ("Rollback SQL").

-- 1. Enums --------------------------------------------------------------------

CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'NON_BINARY', 'PREFER_NOT_TO_SAY');

CREATE TYPE "CollegeAffiliationMethod" AS ENUM ('LEGACY_PRIMARY_EMAIL', 'CAMPUS_OTP');

-- Postgres allows ADD VALUE inside a transaction (12+), but a value added here
-- cannot be USED in the same transaction. Nothing below references either one.
ALTER TYPE "UserOtpPurpose" ADD VALUE IF NOT EXISTS 'COLLEGE_EMAIL';
ALTER TYPE "UserOtpPurpose" ADD VALUE IF NOT EXISTS 'PERSONAL_EMAIL';

-- 2. New nullable columns ------------------------------------------------------

ALTER TABLE "User" ADD COLUMN "gender" "Gender";

-- The normalized address a code was sent to, and the college selected with it,
-- so a verification cannot be redirected to another address or college.
ALTER TABLE "UserOtp" ADD COLUMN "target" TEXT;
ALTER TABLE "UserOtp" ADD COLUMN "collegeId" TEXT;

-- 3. CollegeAffiliation --------------------------------------------------------

CREATE TABLE "CollegeAffiliation" (
  "id"              TEXT NOT NULL,
  "userId"          TEXT NOT NULL,
  "collegeId"       TEXT NOT NULL,
  "email"           TEXT NOT NULL,
  "emailNormalized" TEXT NOT NULL,
  "method"          "CollegeAffiliationMethod" NOT NULL,
  "verifiedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt"       TIMESTAMP(3),
  "revokedReason"   VARCHAR(300),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CollegeAffiliation_pkey" PRIMARY KEY ("id")
);

-- One affiliation per user.
CREATE UNIQUE INDEX "CollegeAffiliation_userId_key" ON "CollegeAffiliation"("userId");

-- One owner per college address, across revoked rows too (an address stays
-- reserved until its row is deleted).
CREATE UNIQUE INDEX "CollegeAffiliation_emailNormalized_key" ON "CollegeAffiliation"("emailNormalized");

CREATE INDEX "CollegeAffiliation_collegeId_idx" ON "CollegeAffiliation"("collegeId");

ALTER TABLE "CollegeAffiliation"
  ADD CONSTRAINT "CollegeAffiliation_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CollegeAffiliation"
  ADD CONSTRAINT "CollegeAffiliation_collegeId_fkey"
  FOREIGN KEY ("collegeId") REFERENCES "College"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4. Legacy backfill -----------------------------------------------------------
--
-- Every pre-existing account signed up with an address on an approved college
-- domain, confirmed by Supabase OTP. One LEGACY_PRIMARY_EMAIL affiliation is
-- created per user where ALL of these hold:
--   * "collegeId" is set and the account is not deleted;
--   * the domain of "email" maps (via CollegeDomain, any status: it was approved
--     when the account signed up) to that same college;
--   * no other candidate row shares the normalized address.
--
-- normalized = lower(trim(email)). The application's normalizer
-- (normalizeCollegeEmail) produces the same string for ASCII addresses; the
-- domain match below uses the same lower(trim()) on the stored domain, which
-- the admin console already stores normalized.
--
-- Duplicates are skipped entirely (neither copy is backfilled) rather than
-- resolved by guesswork; scripts/college-affiliation-report.ts lists them. The
-- NOT EXISTS guard makes the INSERT a no-op for users that already have a row,
-- so no unique violation is possible on either index.
--
-- gen_random_uuid() is built in from Postgres 13.
WITH candidates AS (
  SELECT
    u."id"                AS "userId",
    u."collegeId"         AS "collegeId",
    trim(u."email")       AS "email",
    lower(trim(u."email")) AS "emailNormalized"
  FROM "User" u
  WHERE u."collegeId" IS NOT NULL
    AND u."deletedAt" IS NULL
    AND u."email" LIKE '%_@_%'
    AND EXISTS (
      SELECT 1
      FROM "CollegeDomain" d
      WHERE d."collegeId" = u."collegeId"
        AND lower(trim(d."domain")) = split_part(lower(trim(u."email")), '@', 2)
    )
),
unique_candidates AS (
  SELECT c.*,
         count(*) OVER (PARTITION BY c."emailNormalized") AS "dupes"
  FROM candidates c
)
INSERT INTO "CollegeAffiliation" (
  "id", "userId", "collegeId", "email", "emailNormalized", "method",
  "verifiedAt", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  uc."userId",
  uc."collegeId",
  uc."email",
  uc."emailNormalized",
  'LEGACY_PRIMARY_EMAIL'::"CollegeAffiliationMethod",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM unique_candidates uc
WHERE uc."dupes" = 1
  -- Exactly one '@' (split_part above would otherwise compare the wrong part).
  AND position('@' IN substr(uc."emailNormalized", position('@' IN uc."emailNormalized") + 1)) = 0
  AND NOT EXISTS (
    SELECT 1 FROM "CollegeAffiliation" a
    WHERE a."userId" = uc."userId" OR a."emailNormalized" = uc."emailNormalized"
  );

-- Keep the mirror's address in step with the backfilled affiliation, for rows
-- where it is empty. Never overwrites a non-null value.
UPDATE "User" u
SET "collegeEmail" = a."email"
FROM "CollegeAffiliation" a
WHERE a."userId" = u."id"
  AND u."collegeEmail" IS NULL;
