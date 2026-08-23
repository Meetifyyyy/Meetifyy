-- Purge every existing Instant Match conversation and its data.
--
-- The dedicated Instant Match chat replaces the old behaviour, where these
-- conversations lived inside normal Messages as flagged DMs. Rows written
-- under the old model have no dedicated-chat session state, appear under a
-- conversation type the Messages UI no longer renders, and reference a
-- greeting message the thread no longer displays. Rather than migrate that
-- state into a shape the new model can serve, it is deleted: these are
-- temporary 24-hour conversations by design, so nothing here is meant to be
-- kept, and the oldest of them expired long before this deploy.
--
-- Ordering matters. Children are removed before parents even where a cascade
-- exists, so this migration does not depend on the exact ON DELETE rule of
-- every FK — some of these are cascades and some are not, and a purge is a
-- bad place to discover which.

-- 1. Detach the self-reference first. Conversation.pinnedMessageId points at
--    Message, and Message.conversationId points back — deleting either side
--    first without this trips the constraint.
UPDATE "Conversation"
SET "pinnedMessageId" = NULL,
    "lastMessageId" = NULL,
    "lastMessageText" = NULL,
    "lastMessageType" = NULL,
    "lastMessageAt" = NULL,
    "lastMessageSenderId" = NULL
WHERE "type" = 'INSTANT_MATCH' OR "isInstantMatch" = true;

-- 2. Message-scoped children.
DELETE FROM "MessageReaction"
WHERE "messageId" IN (
  SELECT m."id" FROM "Message" m
  JOIN "Conversation" c ON m."conversationId" = c."id"
  WHERE c."type" = 'INSTANT_MATCH' OR c."isInstantMatch" = true
);

DELETE FROM "DeletedMessage"
WHERE "messageId" IN (
  SELECT m."id" FROM "Message" m
  JOIN "Conversation" c ON m."conversationId" = c."id"
  WHERE c."type" = 'INSTANT_MATCH' OR c."isInstantMatch" = true
);

-- 3. Break the reply chain before deleting. Message.replyToId is a
--    self-reference, and foreign keys are checked per row — so deleting a
--    parent message while a reply in the same statement still points at it
--    can fail depending on the order Postgres happens to visit rows.
UPDATE "Message"
SET "replyToId" = NULL
WHERE "conversationId" IN (
  SELECT "id" FROM "Conversation"
  WHERE "type" = 'INSTANT_MATCH' OR "isInstantMatch" = true
);

-- 4. Messages.
DELETE FROM "Message"
WHERE "conversationId" IN (
  SELECT "id" FROM "Conversation"
  WHERE "type" = 'INSTANT_MATCH' OR "isInstantMatch" = true
);

-- 5. Participants — this is what also clears any unread counters these
--    conversations were still carrying against a user.
DELETE FROM "ConversationParticipant"
WHERE "conversationId" IN (
  SELECT "id" FROM "Conversation"
  WHERE "type" = 'INSTANT_MATCH' OR "isInstantMatch" = true
);

-- 6. Any notification that deep-links into one of these conversations would
--    now dead-end, so it goes too.
DELETE FROM "Notification"
WHERE "entityType" = 'MESSAGE'
  AND "entityId" IN (
    SELECT "id"::text FROM "Conversation"
    WHERE "type" = 'INSTANT_MATCH' OR "isInstantMatch" = true
    UNION
    SELECT "publicId" FROM "Conversation"
    WHERE ("type" = 'INSTANT_MATCH' OR "isInstantMatch" = true)
      AND "publicId" IS NOT NULL
  );

-- 7. Release the match sessions' reference before the conversations go.
--    MatchSession.conversationId is a plain column, not an FK, so a stale
--    value would otherwise linger and point at nothing.
UPDATE "MatchSession"
SET "conversationId" = NULL,
    "chatStatus" = 'EXPIRED',
    "endedAt" = COALESCE("endedAt", NOW())
WHERE "conversationId" IN (
  SELECT "id" FROM "Conversation"
  WHERE "type" = 'INSTANT_MATCH' OR "isInstantMatch" = true
);

-- 8. The conversations themselves.
DELETE FROM "Conversation"
WHERE "type" = 'INSTANT_MATCH' OR "isInstantMatch" = true;

-- 9. Finally the match sessions. Only those that opened a chat are removed;
--    PENDING/DECLINED/EXPIRED handshake rows are left alone because the
--    re-match cooldown reads them, and wiping them would let everyone be
--    immediately re-paired with someone they just passed on.
DELETE FROM "MatchSession"
WHERE "status" = 'ACCEPTED';

-- Queue entries are transient (30-minute TTL) and are swept automatically,
-- so they are deliberately not touched here.
