-- Replaces the old Gmail contact address in the published legal documents with
-- support@meetifyy.app.
--
-- Earlier migrations (7, 16, 21) are already applied and must not be edited, so
-- this publishes a new version of each affected document instead: a copy of the
-- CURRENT version (including any admin edits made since) with only the address
-- changed. Published silently, like migrations 16 and 21:
-- requiresAcknowledgement = false, so nobody is put behind the update screen.
-- The previous version is archived, never deleted. A document whose current
-- version no longer contains the address is left alone, so this is a no-op on a
-- database that has already been corrected by hand. No CONCURRENTLY, no
-- schema-qualified names.

WITH archived AS (
  UPDATE "LegalDocumentVersion"
  SET "isCurrent" = false, "status" = 'ARCHIVED', "updatedAt" = CURRENT_TIMESTAMP
  WHERE "isCurrent" = true
    AND "content" LIKE '%app.meetifyy@gmail.com%'
  RETURNING "documentType", "title", "subtitle", "content"
)
INSERT INTO "LegalDocumentVersion" (
  "id","documentType","versionNumber","title","subtitle","content","status",
  "isCurrent","requiresAcknowledgement","changeSummary","effectiveAt",
  "createdById","createdAt","updatedAt","publishedById","publishedAt"
)
SELECT
  gen_random_uuid()::text, a."documentType",
  COALESCE((SELECT max(v."versionNumber") FROM "LegalDocumentVersion" v WHERE v."documentType" = a."documentType"), 0) + 1,
  a."title", a."subtitle",
  replace(a."content", 'app.meetifyy@gmail.com', 'support@meetifyy.app'),
  'PUBLISHED', true, false,
  $legal$Updated our contact address to support@meetifyy.app.$legal$,
  CURRENT_TIMESTAMP,
  NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL, CURRENT_TIMESTAMP
FROM archived a;
