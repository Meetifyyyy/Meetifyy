-- Recreates the performance indexes from the four earlier "perf indexes"
-- migrations, without CONCURRENTLY.
--
-- Those migrations could never apply through `prisma migrate deploy`. Prisma
-- runs each migration file inside a transaction, and Postgres rejects
-- CREATE INDEX CONCURRENTLY there (SQLSTATE 25001), so the first deploy against
-- a fresh database failed at 20260729000001_perf_indexes and P3009 then blocked
-- every later migration. CONCURRENTLY was chosen to avoid locking live tables,
-- but these indexes only ever get created once, when the environment is built
-- and the tables are empty -- so the lock it avoids does not exist in practice.
--
-- Every statement is IF NOT EXISTS, so this is a no-op where the indexes were
-- already created by other means.

-- from 20260729000001_perf_indexes
CREATE INDEX IF NOT EXISTS "idx_cp_convid_deletedat_userid"
 ON "ConversationParticipant"("conversationId", "deletedAt", "userId");

-- from 20260729000001_perf_indexes
CREATE INDEX IF NOT EXISTS "idx_notif_recipient_unread"
 ON "Notification"("recipientId", "readAt", "deletedAt")
 WHERE "readAt" IS NULL AND "deletedAt" IS NULL;

-- from 20260729000001_perf_indexes
CREATE INDEX IF NOT EXISTS "idx_message_conv_sort"
 ON "Message"("conversationId", "deletedAt", "createdAt" DESC, "id" DESC)
 WHERE "deletedAt" IS NULL;

-- from 20260729000001_perf_indexes
CREATE INDEX IF NOT EXISTS "idx_cp_userid_deletedat"
 ON "ConversationParticipant"("userId", "deletedAt")
 WHERE "deletedAt" IS NULL;

-- from 20260729230000_activities_perf_indexes
CREATE INDEX IF NOT EXISTS "idx_crew_activity_public_feed"
 ON "CrewActivity" ("createdAt" DESC)
 WHERE "deletedAt" IS NULL AND "status" = 'OPEN' AND "visibility" = 'PUBLIC';

-- from 20260729230000_activities_perf_indexes
CREATE INDEX IF NOT EXISTS "idx_crew_activity_campus_feed"
 ON "CrewActivity" ("collegeId", "createdAt" DESC)
 WHERE "deletedAt" IS NULL AND "status" = 'OPEN' AND "visibility" != 'PRIVATE';

-- from 20260729230000_activities_perf_indexes
CREATE INDEX IF NOT EXISTS "idx_crew_activity_member_status"
 ON "CrewActivityMember" ("userId", "status", "activityId");

-- from 20260729230000_activities_perf_indexes
CREATE INDEX IF NOT EXISTS "idx_activity_invitation_invitee_status"
 ON "ActivityInvitation" ("inviteeId", "status", "activityId");

-- from 20260730000001_campus_covering_index
CREATE INDEX IF NOT EXISTS "Community_collegeId_isCampusCommunity_deletedAt_memberCount_idx"
 ON "Community" ("collegeId", "isCampusCommunity", "deletedAt", "memberCount" DESC);
