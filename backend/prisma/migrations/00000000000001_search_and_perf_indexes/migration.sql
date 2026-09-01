-- Indexes Prisma's schema language cannot express, and the extension they need.
--
-- `@@index` cannot declare an operator class, so the trigram GIN indexes behind
-- fuzzy search have to be written in SQL. They live outside 00000000000000_init
-- because that file is generated from the datamodel and is rewritten wholesale
-- if the history is ever squashed again.
--
-- Nothing here uses CONCURRENTLY: Prisma runs each migration inside a
-- transaction, and Postgres rejects CREATE INDEX CONCURRENTLY there (25001).
-- That mistake is what broke the first production deploy.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Fuzzy-search trigram indexes (GIN + gin_trgm_ops)
CREATE INDEX IF NOT EXISTS user_username_trgm_idx ON "User" USING GIN (username gin_trgm_ops);
CREATE INDEX IF NOT EXISTS user_display_name_trgm_idx ON "User" USING GIN ("displayName" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS user_bio_trgm_idx ON "User" USING GIN (bio gin_trgm_ops);
CREATE INDEX IF NOT EXISTS community_name_trgm_idx ON "Community" USING GIN (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS community_slug_trgm_idx ON "Community" USING GIN (slug gin_trgm_ops);
CREATE INDEX IF NOT EXISTS community_description_trgm_idx ON "Community" USING GIN (description gin_trgm_ops);
CREATE INDEX IF NOT EXISTS post_text_trgm_idx ON "Post" USING GIN (text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS crew_activity_title_trgm_idx ON "CrewActivity" USING GIN (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS crew_activity_description_trgm_idx ON "CrewActivity" USING GIN (description gin_trgm_ops);
CREATE INDEX IF NOT EXISTS crew_activity_location_trgm_idx ON "CrewActivity" USING GIN (location gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "HelpArticle_question_trgm_idx" ON "HelpArticle" USING GIN ("question" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "HelpArticle_keywords_idx" ON "HelpArticle" USING GIN ("keywords");

-- Query-plan indexes, tuned against production logs
CREATE INDEX IF NOT EXISTS "idx_cp_convid_deletedat_userid"

 ON "ConversationParticipant"("conversationId", "deletedAt", "userId");

CREATE INDEX IF NOT EXISTS "idx_notif_recipient_unread"

 ON "Notification"("recipientId", "readAt", "deletedAt")

 WHERE "readAt" IS NULL AND "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "idx_message_conv_sort"

 ON "Message"("conversationId", "deletedAt", "createdAt" DESC, "id" DESC)

 WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "idx_cp_userid_deletedat"

 ON "ConversationParticipant"("userId", "deletedAt")

 WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "idx_crew_activity_public_feed"

 ON "CrewActivity" ("createdAt" DESC)

 WHERE "deletedAt" IS NULL AND "status" = 'OPEN' AND "visibility" = 'PUBLIC';

CREATE INDEX IF NOT EXISTS "idx_crew_activity_campus_feed"

 ON "CrewActivity" ("collegeId", "createdAt" DESC)

 WHERE "deletedAt" IS NULL AND "status" = 'OPEN' AND "visibility" != 'PRIVATE';

CREATE INDEX IF NOT EXISTS "idx_crew_activity_member_status"

 ON "CrewActivityMember" ("userId", "status", "activityId");

CREATE INDEX IF NOT EXISTS "idx_activity_invitation_invitee_status"

 ON "ActivityInvitation" ("inviteeId", "status", "activityId");

CREATE INDEX IF NOT EXISTS "Community_collegeId_isCampusCommunity_deletedAt_memberCount_idx"

 ON "Community" ("collegeId", "isCampusCommunity", "deletedAt", "memberCount" DESC);
