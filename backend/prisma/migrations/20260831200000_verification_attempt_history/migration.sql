-- Verification attempts accumulate instead of overwriting.
--
-- `userId` was UNIQUE, so a resubmission had to upsert over the previous row —
-- destroying the earlier attempt along with the reason it was rejected. The
-- rule that constraint was really enforcing ("one open request per user") is
-- re-established below as a partial unique index, which keeps the guarantee
-- without preventing history.

-- 1. Stop enforcing one row per user.
DROP INDEX "VerificationRequest_userId_key";

-- 2. New columns, nullable for now so existing rows can be backfilled.
ALTER TABLE "VerificationRequest" ADD COLUMN "attemptNumber" INTEGER;
ALTER TABLE "VerificationRequest" ADD COLUMN "reviewedAt" TIMESTAMP(3);

-- 3. Number the attempts that already exist, oldest first per user. Every
--    current row is that user's attempt 1, but ROW_NUMBER keeps this correct
--    even if the constraint were ever missing.
UPDATE "VerificationRequest" vr
SET "attemptNumber" = numbered.rn
FROM (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY "userId" ORDER BY "createdAt", id) AS rn
  FROM "VerificationRequest"
) AS numbered
WHERE vr.id = numbered.id;

-- 4. A request that is no longer pending was decided at some point; the best
--    record of when is its last write. Pending rows correctly stay null.
UPDATE "VerificationRequest"
SET "reviewedAt" = "updatedAt"
WHERE "status" <> 'PENDING' AND "reviewedAt" IS NULL;

-- 5. Now that every row has one, the column is required.
ALTER TABLE "VerificationRequest" ALTER COLUMN "attemptNumber" SET NOT NULL;

-- 6. Indexes for history lookups and attempt identity.
CREATE INDEX "VerificationRequest_userId_createdAt_idx" ON "VerificationRequest"("userId", "createdAt");
CREATE UNIQUE INDEX "VerificationRequest_userId_attemptNumber_key" ON "VerificationRequest"("userId", "attemptNumber");

-- 7. One open request per user, enforced by the database rather than by service
--    code. This is what makes a double-clicked submit, two tabs, or two
--    concurrent API calls impossible to turn into duplicate pending requests:
--    the second INSERT violates this index and the service maps it to a 409.
--    Prisma cannot express a partial index, so it lives here and is documented
--    on the model.
CREATE UNIQUE INDEX "VerificationRequest_userId_pending_key"
  ON "VerificationRequest"("userId")
  WHERE "status" = 'PENDING';
