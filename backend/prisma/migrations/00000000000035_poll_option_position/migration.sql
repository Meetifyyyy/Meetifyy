-- Poll options keep the order their author gave them.
--
-- There was no column for it, and every read sorted options by their id, a
-- random UUID, so polls were shown in an order nobody chose. New options are
-- written with `position` 0, 1, 2… and every read orders by it, then by id.
--
-- Existing options: the order they were typed in was never stored. They were
-- inserted in that order by a single statement, so their physical order is
-- the best record left, and it is still the typed order for options no vote
-- has rewritten yet. That is what is copied here; it is best effort, and a
-- poll whose options have been voted on may keep a different order.
--
-- Vote counts: every read path now shows the stored `voteCount` (the feed
-- always did; the post page and search counted vote rows instead). A purged
-- account's votes were deleted without lowering it, so the two disagreed.
-- It is recounted once here from the votes themselves; from now on the
-- purge lowers it as it deletes.
--
-- Additive with a default, so the release before this one (which never
-- reads or writes the column) runs unchanged against it. No CONCURRENTLY.

ALTER TABLE "PollOption" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;

UPDATE "PollOption" o
SET "position" = ranked.position
FROM (
  SELECT "id", (ROW_NUMBER() OVER (PARTITION BY "postId" ORDER BY ctid) - 1)::INTEGER AS position
  FROM "PollOption"
) ranked
WHERE o."id" = ranked."id";

-- After the position backfill, which reads the physical order this rewrites.
UPDATE "PollOption" o
SET "voteCount" = c.n
FROM (
  SELECT po."id", COUNT(pv."id")::INTEGER AS n
  FROM "PollOption" po
  LEFT JOIN "PollVote" pv ON pv."optionId" = po."id"
  GROUP BY po."id"
) c
WHERE o."id" = c."id" AND o."voteCount" <> c.n;
