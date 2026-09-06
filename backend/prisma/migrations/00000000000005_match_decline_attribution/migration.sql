-- Records which side passed on a declined Instant Match pairing.
--
-- Nullable and unread by the previous release, so this is safe in both
-- directions: the running image ignores the column, and the new image treats
-- a NULL on an existing DECLINED row as "we do not know who passed" — which
-- is exactly what was true before the column existed.
--
-- No backfill. Attribution cannot be reconstructed from history, and guessing
-- would poison the very signal the column exists to feed.
ALTER TABLE "MatchSession" ADD COLUMN "declinedById" TEXT;
