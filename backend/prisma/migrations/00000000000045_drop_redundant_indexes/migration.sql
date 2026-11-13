-- D-4: drop 24 redundant indexes, chosen from production and dev statistics
-- (C-4, 2026-11-14; DATABASE_AUDIT.md section 7.1).
--
-- Each one is either an exact duplicate of another index or the leading
-- prefix of a longer index, and none was scanned once on production (since
-- 2026-08-25) or dev (since 2026-07-24), while the index covering it was. A
-- B-tree on (a, b) serves every lookup and order an index on (a) serves,
-- foreign-key checks and cascades included, so no query loses its index; the
-- writes stop paying for one more index entry per row.
--
-- Nine prefix indexes the planner does prefer (Block, Follow, PostLike,
-- CommunityMember.userId, Post.authorId, VerificationRequest.status,
-- Comment.postId, User.collegeId) are deliberately kept.
--
-- IF EXISTS: an environment built before one of them existed simply skips
-- it. Plain DROP INDEX (never CONCURRENTLY: Prisma runs each migration in a
-- transaction); these tables are small. Backward-compatible: no query
-- requires a specific index.

-- Exact duplicates.
DROP INDEX IF EXISTS "ConversationParticipant_conversationId_deletedAt_userId_idx";
DROP INDEX IF EXISTS "LegalDocumentVersion_documentType_versionNumber_idx";
DROP INDEX IF EXISTS "ActivityInvitation_activityId_inviteeId_idx";

-- Leading prefixes of a longer index that carries the traffic.
DROP INDEX IF EXISTS "ActivityBookmark_userId_idx";
DROP INDEX IF EXISTS "ActivityInvitation_inviteeId_status_idx";
DROP INDEX IF EXISTS "CampusEvent_createdBy_idx";
DROP INDEX IF EXISTS "CollegeDomain_collegeId_idx";
DROP INDEX IF EXISTS "CommentLike_userId_idx";
DROP INDEX IF EXISTS "CommunityMember_communityId_idx";
DROP INDEX IF EXISTS "ConversationJoinRequest_conversationId_idx";
DROP INDEX IF EXISTS "CrewActivity_status_idx";
DROP INDEX IF EXISTS "CrewActivityMember_userId_idx";
DROP INDEX IF EXISTS "CrewActivityMember_activityId_idx";
DROP INDEX IF EXISTS "DeletedMessage_userId_idx";
DROP INDEX IF EXISTS "HelpArticle_status_idx";
DROP INDEX IF EXISTS "LegalAcknowledgement_userId_idx";
DROP INDEX IF EXISTS "Mention_userId_idx";
DROP INDEX IF EXISTS "MessageReaction_messageId_idx";
DROP INDEX IF EXISTS "Mute_muterId_idx";
DROP INDEX IF EXISTS "Post_deletedAt_createdAt_idx";
DROP INDEX IF EXISTS "PostBookmark_userId_idx";
DROP INDEX IF EXISTS "PostShare_userId_idx";
DROP INDEX IF EXISTS "PostShare_postId_idx";
DROP INDEX IF EXISTS "User_collegeId_course_idx";
