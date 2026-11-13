-- IM-19b (E-7): two Instant Match index changes, chosen with EXPLAIN on a
-- synthetic dataset (20,000 conversations, 50,000 match sessions, PGlite).
--
-- 1. The 5-minute Instant Match chat cleanup reads
--    `"isInstantMatch" AND "expiresAt" < now()` and had no index, so it
--    scanned every conversation (3.8 ms there, growing with every DM and
--    group). This partial index holds only Instant Match chats, which live
--    24 hours, so it stays a few rows and a DM or group never writes to it:
--    0.02 ms. Prisma cannot express a partial index; it is noted on the
--    Conversation model instead.
-- 2. The queue's (campus, activity, timePreference, expiresAt) index has been
--    read by nothing since campus stopped being a filter, while every join
--    and requeue paid to maintain it.
--
-- Plain CREATE INDEX, never CONCURRENTLY: Prisma runs each migration in a
-- transaction. Building it holds off writes to "Conversation" for one pass
-- over the table. The code needs neither change, so rolling back the image is
-- safe.
CREATE INDEX IF NOT EXISTS "Conversation_instantMatch_expiresAt_idx"
  ON "Conversation" ("expiresAt")
  WHERE "isInstantMatch";

DROP INDEX IF EXISTS "MatchQueueEntry_campus_activity_timePreference_expiresAt_idx";
