-- What a learned Instant Match ranker will be fitted on (phase 1 of the
-- learning plan, docs/private/backend-optimization/E7_MATCHING_ALGORITHM_REVIEW.md).
--
-- `features`: each proposed pairing's per-signal values (0..1, never the raw
-- inputs: no coordinates, no campus, no text) and weights, its intent, the
-- bar it had to clear and how it was chosen. `aMessageCount` / `bMessageCount`:
-- how many messages each side sent, counted when the chat ends (counts only),
-- because the messages themselves are deleted then.
--
-- Additive and nullable, so a rollback of the image is safe: the previous
-- release never reads or writes these columns.

ALTER TABLE "MatchSession" ADD COLUMN "features" JSONB;
ALTER TABLE "MatchSession" ADD COLUMN "aMessageCount" INTEGER;
ALTER TABLE "MatchSession" ADD COLUMN "bMessageCount" INTEGER;
