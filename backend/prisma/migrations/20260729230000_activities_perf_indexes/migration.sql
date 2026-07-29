-- =====================================================================
-- Activities Subsystem Performance Indexes
-- Partial composite indexes for fast feed generation & invitation status lookups
-- =====================================================================

-- 1. CrewActivity: Public Feed covering index (status OPEN, visibility PUBLIC, deletedAt IS NULL)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_crew_activity_public_feed"
  ON "CrewActivity" ("createdAt" DESC)
  WHERE "deletedAt" IS NULL AND "status" = 'OPEN' AND "visibility" = 'PUBLIC';

-- 2. CrewActivity: Campus Feed covering index (collegeId, non-PRIVATE status OPEN)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_crew_activity_campus_feed"
  ON "CrewActivity" ("collegeId", "createdAt" DESC)
  WHERE "deletedAt" IS NULL AND "status" = 'OPEN' AND "visibility" != 'PRIVATE';

-- 3. CrewActivityMember: Composite index for batch activity membership lookups
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_crew_activity_member_status"
  ON "CrewActivityMember" ("userId", "status", "activityId");

-- 4. ActivityInvitation: Composite index for invitee pending status lookups
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_activity_invitation_invitee_status"
  ON "ActivityInvitation" ("inviteeId", "status", "activityId");
