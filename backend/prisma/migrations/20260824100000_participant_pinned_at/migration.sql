-- Per-user pin ordering for the chat list.
--
-- `isPinned` alone only says *that* a chat is pinned, so pinned chats fell back
-- to last-activity ordering among themselves and a freshly pinned chat could
-- land below older pins — reading as if the pin had not applied. `pinnedAt`
-- gives the list a stable, per-user ordering key.
ALTER TABLE "ConversationParticipant" ADD COLUMN "pinnedAt" TIMESTAMP(3);

-- Existing pins predate the column; seed them from join time so they order
-- deterministically instead of all sorting as NULL.
UPDATE "ConversationParticipant" SET "pinnedAt" = "joinedAt" WHERE "isPinned" = true;

CREATE INDEX "ConversationParticipant_userId_isPinned_pinnedAt_idx"
  ON "ConversationParticipant"("userId", "isPinned", "pinnedAt" DESC);
