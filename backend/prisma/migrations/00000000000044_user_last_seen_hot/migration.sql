-- Presence writes to "User"."lastSeenAt" become HOT updates.
--
-- The column is written at most every 15 minutes per active user. Indexed, it
-- could never be updated in place: each write made a new row version and a
-- new entry in all 23 of User's indexes, including three trigram GIN indexes.
-- Production (C-4, 2026-11-14) showed this write as the slowest statement on
-- the table, at 18 ms mean, with User updates only 28% HOT. On PGlite with
-- 5,000 synthetic users, dropping the index took the write from 0% to 99% HOT
-- (0.92 to 0.40 ms), and stopped the indexes growing with every write.
--
-- Its only readers are the admin dashboard's "active today" count and the
-- nightly affinity rebuild, both fine on a scan of this table. The fillfactor
-- leaves room on each page for HOT updates; it applies to pages as they are
-- written, so nothing is rewritten here.
--
-- Plain DROP INDEX (never CONCURRENTLY: Prisma runs each migration in a
-- transaction). Backward-compatible: no query requires the index.
DROP INDEX IF EXISTS "User_lastSeenAt_idx";

ALTER TABLE "User" SET (fillfactor = 90);
