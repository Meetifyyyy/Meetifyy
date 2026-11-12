-- Indexes for foreign keys whose ON DELETE action has to find referencing rows.
--
-- When a referenced row is deleted, Postgres runs `... WHERE <fk column> = $1`
-- against the referencing table once per deleted row (SET NULL: an UPDATE,
-- RESTRICT/CASCADE: a lookup). With no index that leads with the FK column,
-- each of those is a sequential scan. The worst cases are the largest tables:
-- every message delete scans "Message" once per row (replyToId), and every
-- media delete scans "Message" and "User" (attachmentMediaId, avatarMediaId,
-- coverMediaId). The Instant Match cleanup deletes conversations every 5 min.
--
-- Every column below is NULL on most rows, so each index is PARTIAL
-- (WHERE col IS NOT NULL): it holds only the rows that actually reference
-- something, and adds nothing to writes of rows where the column is NULL. A
-- `col = $1` predicate implies `col IS NOT NULL`, so the RI query can use it.
--
-- Prisma's schema language cannot express a partial index, so these are
-- written here and deliberately NOT declared in schema.prisma, exactly like
-- idx_message_conv_sort and idx_notif_recipient_unread in
-- 00000000000001_search_and_perf_indexes. Prisma's schema engine filters
-- partial indexes out of introspection (`indpred IS NULL`), so migrate diff
-- and drift detection never see them and never propose dropping them. Do not
-- add a matching @@index to schema.prisma: Prisma would then create a second,
-- non-partial index. If the history is ever squashed they must be carried
-- forward by hand (see docs/DATABASE.md).
--
-- Notification.entityId is not a foreign key, but the account purge and the
-- community delete run `deleteMany({ where: { entityId: { in: [...] } } })`;
-- its only existing index is the UNIQUE (recipientId, actorId, entityId, type)
-- where it is third, so those deletes scanned the whole table.
--
-- Purely additive and backward-compatible with the previous release: it only
-- adds indexes. Not CONCURRENTLY (Prisma runs a migration in a transaction).
-- CREATE INDEX blocks writes to the table while it builds; the tables are small
-- today, but check sizes before applying to a large database.

-- P1: largest tables, every message / media delete
CREATE INDEX IF NOT EXISTS "idx_message_reply_to_id"
  ON "Message" ("replyToId") WHERE "replyToId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_message_attachment_media_id"
  ON "Message" ("attachmentMediaId") WHERE "attachmentMediaId" IS NOT NULL;

-- P2
CREATE INDEX IF NOT EXISTS "idx_conversation_pinned_message_id"
  ON "Conversation" ("pinnedMessageId") WHERE "pinnedMessageId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_user_avatar_media_id"
  ON "User" ("avatarMediaId") WHERE "avatarMediaId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_user_cover_media_id"
  ON "User" ("coverMediaId") WHERE "coverMediaId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_media_owner_id"
  ON "Media" ("ownerId") WHERE "ownerId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_notification_actor_id"
  ON "Notification" ("actorId") WHERE "actorId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_notification_entity_id"
  ON "Notification" ("entityId") WHERE "entityId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_comment_parent_id"
  ON "Comment" ("parentId") WHERE "parentId" IS NOT NULL;

-- P3: small tables today, rare deletes
CREATE INDEX IF NOT EXISTS "idx_community_avatar_media_id"
  ON "Community" ("avatarMediaId") WHERE "avatarMediaId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_community_cover_media_id"
  ON "Community" ("coverMediaId") WHERE "coverMediaId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_conversation_avatar_media_id"
  ON "Conversation" ("avatarMediaId") WHERE "avatarMediaId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_crew_activity_cover_media_id"
  ON "CrewActivity" ("coverMediaId") WHERE "coverMediaId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_campus_event_poster_media_id"
  ON "CampusEvent" ("posterMediaId") WHERE "posterMediaId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_college_logo_media_id"
  ON "College" ("logoMediaId") WHERE "logoMediaId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_college_banner_media_id"
  ON "College" ("bannerMediaId") WHERE "bannerMediaId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_verification_request_selfie_media_id"
  ON "VerificationRequest" ("selfieMediaId") WHERE "selfieMediaId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_verification_request_id_card_media_id"
  ON "VerificationRequest" ("idCardMediaId") WHERE "idCardMediaId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_verification_request_reviewer_id"
  ON "VerificationRequest" ("reviewerId") WHERE "reviewerId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_conversation_join_request_decided_by_id"
  ON "ConversationJoinRequest" ("decidedById") WHERE "decidedById" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_legal_document_version_created_by_id"
  ON "LegalDocumentVersion" ("createdById") WHERE "createdById" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_legal_document_version_published_by_id"
  ON "LegalDocumentVersion" ("publishedById") WHERE "publishedById" IS NOT NULL;
