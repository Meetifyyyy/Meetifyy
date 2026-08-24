-- One-time "you are now a moderator" notice, shown on the next community open.
--
-- Two timestamps rather than a boolean, because the requirement is once per
-- PROMOTION, not once ever: a member who is demoted and later promoted again is
-- being handed the role a second time and should be told again. The notice is
-- pending whenever the acknowledgement is missing or older than the promotion
-- that followed it. A single flag would have to be cleared on demote, and would
-- stay silently set the first time that was missed.
ALTER TABLE "CommunityMember" ADD COLUMN "moderatorPromotedAt" TIMESTAMP(3);
ALTER TABLE "CommunityMember" ADD COLUMN "moderatorNoticeAckedAt" TIMESTAMP(3);

-- Existing moderators were promoted before this feature and have already been
-- doing the job. Treating them as freshly promoted would show every one of them
-- a welcome modal for a role they have held for months, so they start
-- acknowledged: both columns set, acknowledgement not older than the promotion.
UPDATE "CommunityMember"
   SET "moderatorPromotedAt" = "joinedAt",
       "moderatorNoticeAckedAt" = "joinedAt"
 WHERE "role" = 'MODERATOR';
