-- Migration: Add covering index for campus community queries
-- Replaces the partial index (collegeId, isCampusCommunity, deletedAt) with a 4-column
-- covering index that includes memberCount DESC. This allows Postgres to satisfy
-- getCampusCommunities queries entirely from the index, eliminating the post-scan sort step.
--
-- Uses CREATE INDEX CONCURRENTLY so it does not lock the Community table on production.

DROP INDEX CONCURRENTLY IF EXISTS "Community_collegeId_isCampusCommunity_deletedAt_idx";

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Community_collegeId_isCampusCommunity_deletedAt_memberCount_idx"
  ON "Community" ("collegeId", "isCampusCommunity", "deletedAt", "memberCount" DESC);
