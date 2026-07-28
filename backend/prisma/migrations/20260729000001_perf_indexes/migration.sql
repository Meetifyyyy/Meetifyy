-- =====================================================================
-- Performance indexes: targeting slow queries from production logs
-- All use CONCURRENTLY so they can run without table locks in production
-- =====================================================================

-- 1. ConversationParticipant: cover the participant+settings lookup pattern
--    used by markAsRead and getConversationHistory.
--    Eliminates sequential scan on (conversationId, deletedAt) when including user.settings.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_cp_convid_deletedat_userid"
  ON "ConversationParticipant"("conversationId", "deletedAt", "userId");

-- 2. Notification COUNT(*): the 645ms slow query in auth/sync
--    Pattern: WHERE recipientId=$1 AND readAt IS NULL AND deletedAt IS NULL AND type<>$2
--    The existing (recipientId, readAt) index doesn't cover deletedAt, forcing a filter step.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_notif_recipient_unread"
  ON "Notification"("recipientId", "readAt", "deletedAt")
  WHERE "readAt" IS NULL AND "deletedAt" IS NULL;

-- 3. Message: cover the getConversationHistory cursor-based pagination pattern
--    WHERE conversationId=$1 AND deletedAt IS NULL ORDER BY createdAt DESC, id DESC
--    The existing (conversationId, deletedAt, createdAt DESC) is good but missing id for tie-breaking.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_message_conv_sort"
  ON "Message"("conversationId", "deletedAt", "createdAt" DESC, "id" DESC)
  WHERE "deletedAt" IS NULL;

-- 4. ConversationParticipant: cover getUserConversations (conversation list)
--    WHERE userId=$1 AND deletedAt IS NULL — the hot path on every page load
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_cp_userid_deletedat"
  ON "ConversationParticipant"("userId", "deletedAt")
  WHERE "deletedAt" IS NULL;
