-- Message and Notification: fewer indexes, and ones the reads can follow
-- (DATABASE_AUDIT.md section 2.2).
--
-- Message had four indexes over "conversation, then time". Nothing ever sets
-- Message.deletedAt, so the two with deletedAt in the key (one of them partial
-- on deletedAt IS NULL) held the same rows as (conversationId, createdAt DESC,
-- id DESC), and (conversationId, createdAt, senderId) is the same order again.
-- That one index serves the chat page in both directions, the catch-up sync,
-- inbox previews and cascades; a sent message now writes 3 index entries, not 6.
--
-- Notification had (recipientId, deletedAt, createdAt): with an IS NULL test on
-- deletedAt, Postgres cannot use the index for the createdAt order, so the
-- list read and sorted every live row of the person (21,000 rows, 106 ms in
-- the benchmark) before returning 21. The list and the Invitations tab get
-- indexes in the order they are shown instead. `type` is a key column, not a
-- partial-index condition, because Prisma sends it as CAST($n::text AS
-- "NotificationType"), which the planner cannot match to a predicate.
-- (recipientId, readAt), (recipientId, deletedAt, readAt), (createdAt) and
-- (type) serve nothing the remaining indexes do not; unread rows are counted
-- through idx_notif_recipient_unread, kept.
--
-- Measured on PGlite with 240,000 messages and 170,000 notifications, using
-- the SQL Prisma generates: no chat or notification screen slower; the
-- notification list 2.3 ms -> 0.35 ms for a typical person; WAL per write
-- 24-49% smaller (sending a message: half).
--
-- IF [NOT] EXISTS so an environment that lacks one simply skips it. Plain DROP
-- and CREATE (never CONCURRENTLY: Prisma runs each migration in a transaction);
-- both tables are small in production. Backward-compatible: no query requires
-- a specific index, and the previous release issues the same queries.

-- Message
DROP INDEX IF EXISTS "Message_conversationId_createdAt_senderId_idx";
DROP INDEX IF EXISTS "Message_conversationId_deletedAt_createdAt_id_idx";
DROP INDEX IF EXISTS "idx_message_conv_sort";

-- Notification
DROP INDEX IF EXISTS "Notification_recipientId_readAt_idx";
DROP INDEX IF EXISTS "Notification_recipientId_deletedAt_readAt_idx";
DROP INDEX IF EXISTS "Notification_recipientId_deletedAt_createdAt_idx";
DROP INDEX IF EXISTS "Notification_recipientId_deletedAt_type_createdAt_idx";
DROP INDEX IF EXISTS "Notification_createdAt_idx";
DROP INDEX IF EXISTS "Notification_type_idx";

CREATE INDEX IF NOT EXISTS "Notification_recipientId_createdAt_id_idx"
  ON "Notification"("recipientId", "createdAt" DESC, "id" DESC);
CREATE INDEX IF NOT EXISTS "Notification_recipientId_type_createdAt_id_idx"
  ON "Notification"("recipientId", "type", "createdAt" DESC, "id" DESC);
