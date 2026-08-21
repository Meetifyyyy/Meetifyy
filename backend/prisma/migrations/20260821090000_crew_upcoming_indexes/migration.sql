-- Crew discovery reads are all "open, not deleted, hasn't started yet, ordered by
-- start time" — the "For You" ranking pool, the College tab and the 1-on-1 tab.
--
-- The pre-existing [status, deletedAt, endDate, startDate] index cannot serve
-- those: endDate sits between the equality columns and startDate, so Postgres
-- can filter with it but must sort the result separately. These three indexes
-- put startDate directly after the equality prefix for each scope.
--
-- NOTE: Prisma applies a migration inside a transaction, so these are plain
-- CREATE INDEX statements, which take a write lock on CrewActivity while they
-- build. On a large table, create them by hand first with
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS ... ;
-- outside a transaction — the IF NOT EXISTS below then makes this migration a
-- no-op.
CREATE INDEX IF NOT EXISTS "CrewActivity_status_deletedAt_startDate_idx"
  ON "CrewActivity" ("status", "deletedAt", "startDate");

CREATE INDEX IF NOT EXISTS "CrewActivity_collegeId_status_deletedAt_startDate_idx"
  ON "CrewActivity" ("collegeId", "status", "deletedAt", "startDate");

CREATE INDEX IF NOT EXISTS "CrewActivity_maxMembers_status_deletedAt_startDate_idx"
  ON "CrewActivity" ("maxMembers", "status", "deletedAt", "startDate");
