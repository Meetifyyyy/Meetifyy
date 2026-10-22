-- Drops indexes that are exact leading prefixes of another index on the same
-- table. A B-tree on (a, b, ...) serves every lookup, range and ordering a
-- B-tree on (a) or (a, b) can, so these only added work to every insert and
-- update on the two busiest write paths (sending a message, chat membership).
--
--   Message_conversationId_createdAt_idx            ⊂ (conversationId, createdAt, senderId)
--   Message_conversationId_deletedAt_createdAt_idx  ⊂ (conversationId, deletedAt, createdAt DESC, id DESC)
--   Message_senderId_idx                            ⊂ UNIQUE (senderId, clientMessageId)
--   ConversationParticipant_userId_idx              ⊂ PRIMARY KEY (userId, conversationId)
--   ConversationParticipant_userId_deletedAt_idx    ⊂ (userId, deletedAt, leftAt)
--   ConversationParticipant_conversationId_idx      ⊂ (conversationId, deletedAt, userId)
--   ConversationParticipant_conversationId_deletedAt_idx ⊂ (conversationId, deletedAt, userId)
--
-- Backward-compatible: every query of the previous release is served by the
-- longer index. Not CONCURRENTLY (Prisma runs migrations in a transaction).
-- IF EXISTS so an environment that never had one is not an error.
DROP INDEX IF EXISTS "Message_conversationId_createdAt_idx";
DROP INDEX IF EXISTS "Message_conversationId_deletedAt_createdAt_idx";
DROP INDEX IF EXISTS "Message_senderId_idx";
DROP INDEX IF EXISTS "ConversationParticipant_userId_idx";
DROP INDEX IF EXISTS "ConversationParticipant_userId_deletedAt_idx";
DROP INDEX IF EXISTS "ConversationParticipant_conversationId_idx";
DROP INDEX IF EXISTS "ConversationParticipant_conversationId_deletedAt_idx";
