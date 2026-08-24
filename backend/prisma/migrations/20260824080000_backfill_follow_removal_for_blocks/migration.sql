-- Backfill: sever follow edges for blocks that predate the follow-removal fix.
--
-- UsersService.blockUser deletes both Follow rows inside the block transaction,
-- but that only ever fired for blocks made after it shipped. Every block created
-- before then kept its follow edges, which leaves the data saying two people
-- follow each other while every read path treats them as mutually invisible.
--
-- The user-visible symptom is a count that disagrees with its own list: the
-- follower LIST is block-filtered, while the profile's follower COUNT is a plain
-- relation count (User._count.followers). A blocked follower is counted but not
-- listed, so the profile reads one higher than the rows it renders.
--
-- Deleting the edge is the same outcome blockUser would have produced, and it is
-- what both sides already believe to be true. It is not recoverable, but it is
-- also not information either party can still act on: neither can see the other,
-- and unblocking deliberately does not restore a follow.
--
-- Idempotent: re-running deletes nothing once the set is empty.

DELETE FROM "Follow" f
WHERE EXISTS (
  SELECT 1
  FROM "Block" b
  WHERE (b."blockerId" = f."followerId"  AND b."blockedId" = f."followingId")
     OR (b."blockerId" = f."followingId" AND b."blockedId" = f."followerId")
);
