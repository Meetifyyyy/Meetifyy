-- Instant Match: persist each side's original queue request on the match
-- session so the server can re-queue the other user when a match is declined
-- or expires, instead of relying on that client to replay `queue:join`.
ALTER TABLE "MatchSession" ADD COLUMN "snapshotA" JSONB;
ALTER TABLE "MatchSession" ADD COLUMN "snapshotB" JSONB;

-- Drives the expiry sweep, which scans PENDING sessions past their deadline.
CREATE INDEX "MatchSession_status_expiresAt_idx" ON "MatchSession"("status", "expiresAt");

-- Candidate lookup filters on expiry alongside the bucket keys; the old
-- 3-column index forced a heap check for every non-expired row.
DROP INDEX IF EXISTS "MatchQueueEntry_campus_activity_timePreference_idx";
CREATE INDEX "MatchQueueEntry_campus_activity_timePreference_expiresAt_idx"
  ON "MatchQueueEntry"("campus", "activity", "timePreference", "expiresAt");

-- Drives the queue-entry half of the expiry sweep.
CREATE INDEX "MatchQueueEntry_expiresAt_idx" ON "MatchQueueEntry"("expiresAt");
