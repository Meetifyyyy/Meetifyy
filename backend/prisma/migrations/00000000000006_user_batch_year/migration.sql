-- First-year isolation: the student's joining batch, derived from the
-- verified institutional email address.
--
-- See StudentYearPolicyService and docs/first-year-isolation.md.
--
-- Backward compatible in both directions. The column is nullable and the
-- previous release neither reads nor writes it, so a rollback that reverts the
-- image but not the schema leaves a column nothing looks at. The new image
-- treats NULL as "batch unresolved", which is exactly what every row means
-- before the backfill below runs.
--
-- Deliberately NOT a first-year flag. `batchYear` is a fact about the account
-- that never changes; "is this student first-year" is derived per request as
-- `batchYear = <current academic year>`, so the cohort rolls over on 1 January
-- with no migration, no backfill job and no rows to correct.
ALTER TABLE "User" ADD COLUMN "batchYear" INTEGER;

-- Backfill from the address, using the same rule as
-- `extractBatchYearFromEmail`: a programme token (letters, optionally dotted)
-- sitting between the last underscore and the trailing digits.
--
--   sarthak.saini_cs25@gla.ac.in         -> cs      -> 2025
--   shrangika.agnihotri_cs.h25@gla.ac.in -> cs.h    -> 2025
--   aman.usmani_cs.aiml25@gla.ac.in      -> cs.aiml -> 2025
--   aaradhya.rawat_cs.h24@gla.ac.in      -> cs.h    -> 2024
--
-- Two statements rather than one CASE, so the unambiguous four-digit form is
-- settled first and the two-digit form only ever sees rows it did not match.
-- Anything neither pattern recognises stays NULL, which the policy reads as
-- "unresolved" and treats as NOT first-year. Guessing here would hand a
-- malformed account a first-year student's audience.
--
-- Addresses carrying a '+' tag are excluded: the tag is the same mailbox as
-- the untagged address at most providers, so honouring it would let one
-- verified address present two different batches.

-- 1. Four-digit tail: `_cs2025`.
UPDATE "User"
SET "batchYear" = (
  substring(
    split_part(lower("email"), '@', 1)
    from '_[a-z]+(?:\.[a-z]+)*((?:19|20)[0-9]{2})$'
  )
)::int
WHERE "email" IS NOT NULL
  AND position('+' in split_part(lower("email"), '@', 1)) = 0
  AND split_part(lower("email"), '@', 1) ~ '_[a-z]+(\.[a-z]+)*(19|20)[0-9]{2}$';

-- 2. The usual two-digit tail: `_cs25`, `_cs.h24`, `_cs.aiml25`.
UPDATE "User"
SET "batchYear" = 2000 + (
  substring(
    split_part(lower("email"), '@', 1)
    from '_[a-z]+(?:\.[a-z]+)*([0-9]{2})$'
  )
)::int
WHERE "batchYear" IS NULL
  AND "email" IS NOT NULL
  AND position('+' in split_part(lower("email"), '@', 1)) = 0
  AND split_part(lower("email"), '@', 1) ~ '_[a-z]+(\.[a-z]+)*[0-9]{2}$';

-- 3. Fall back to `collegeEmail` for the rows where `email` carried nothing.
--    The two are written together at signup, but only `collegeEmail` survives
--    some admin flows, and the runtime policy checks both for the same reason.
UPDATE "User"
SET "batchYear" = 2000 + (
  substring(
    split_part(lower("collegeEmail"), '@', 1)
    from '_[a-z]+(?:\.[a-z]+)*([0-9]{2})$'
  )
)::int
WHERE "batchYear" IS NULL
  AND "collegeEmail" IS NOT NULL
  AND position('+' in split_part(lower("collegeEmail"), '@', 1)) = 0
  AND split_part(lower("collegeEmail"), '@', 1) ~ '_[a-z]+(\.[a-z]+)*[0-9]{2}$';

-- Every user-producing query gains a batch predicate, so these carry search,
-- recommendations, the directory, the feed and every recipient picker.
CREATE INDEX "User_batchYear_idx" ON "User"("batchYear");
CREATE INDEX "User_collegeId_batchYear_idx" ON "User"("collegeId", "batchYear");
CREATE INDEX "User_accountStatus_batchYear_createdAt_idx"
  ON "User"("accountStatus", "batchYear", "createdAt" DESC);
