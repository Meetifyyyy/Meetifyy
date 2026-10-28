-- A former member keeps the group as it was when they left: its name and photo
-- are copied onto their membership row at that moment (markParticipantLeft),
-- and their conversation list shows those instead of the live group, which they
-- are no longer part of. A rejoin clears both.
--
-- Additive and nullable, so the release before this one runs unchanged against
-- it. No CONCURRENTLY, no schema-qualified names.

ALTER TABLE "ConversationParticipant" ADD COLUMN "leftGroupName" TEXT;
ALTER TABLE "ConversationParticipant" ADD COLUMN "leftGroupAvatarKey" TEXT;

-- Members who left before this existed: the group as it is now is the closest
-- record there is, and from here on it stays put for them.
UPDATE "ConversationParticipant" p
SET "leftGroupName" = c."name",
    "leftGroupAvatarKey" = c."avatarKey"
FROM "Conversation" c
WHERE p."conversationId" = c."id"
  AND p."leftAt" IS NOT NULL
  AND c."type" = 'GROUP';
