-- Instant Match: a dedicated, temporary 24h conversation experience.
--
-- MatchSession gains the chat's own lifecycle, kept separate from the
-- accept-handshake MatchStatus, and existing instant-match conversations move
-- onto the INSTANT_MATCH type added by the preceding migration. Isolation from
-- normal Messages is then structural: every existing query that asks for
-- `type: DM` excludes them automatically.

-- The INSTANT_MATCH ConversationType itself is added by the migration
-- immediately before this one — Postgres will not let a new enum value be used
-- in the transaction that created it.

-- Chat lifecycle -------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'InstantMatchChatStatus') THEN
    CREATE TYPE "InstantMatchChatStatus" AS ENUM ('ACTIVE', 'ENDED_BY_USER', 'EXPIRED');
  END IF;
END$$;

ALTER TABLE "MatchSession"
  ADD COLUMN IF NOT EXISTS "chatStatus" "InstantMatchChatStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS "chatExpiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "endedById" TEXT,
  ADD COLUMN IF NOT EXISTS "endedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "matchReason" TEXT;

CREATE INDEX IF NOT EXISTS "MatchSession_chatStatus_chatExpiresAt_idx"
  ON "MatchSession"("chatStatus", "chatExpiresAt");
CREATE INDEX IF NOT EXISTS "MatchSession_conversationId_idx"
  ON "MatchSession"("conversationId");

-- Backfill ------------------------------------------------------------------
-- Sessions written before this migration have a conversation but no chat
-- window recorded. Their conversation already carries the authoritative
-- 24h deadline, so copy it across; anything already past it is expired.
UPDATE "MatchSession" ms
SET "chatExpiresAt" = c."expiresAt",
    "matchReason"   = COALESCE(ms."matchReason", ms."activity")
FROM "Conversation" c
WHERE ms."conversationId" = c."id"
  AND ms."chatExpiresAt" IS NULL;

UPDATE "MatchSession"
SET "chatStatus" = 'EXPIRED'
WHERE "chatStatus" = 'ACTIVE'
  AND "chatExpiresAt" IS NOT NULL
  AND "chatExpiresAt" <= NOW();

-- A session that never reached ACCEPTED never opened a chat; it must not look
-- like a live one to the "do I have an active instant-match chat?" query.
UPDATE "MatchSession"
SET "chatStatus" = 'EXPIRED'
WHERE "chatStatus" = 'ACTIVE'
  AND ("status" <> 'ACCEPTED' OR "conversationId" IS NULL);

-- Existing instant-match conversations move to the new type, which is what
-- removes them from the normal Messages list.
UPDATE "Conversation"
SET "type" = 'INSTANT_MATCH'
WHERE "isInstantMatch" = true AND "type" = 'DM';
