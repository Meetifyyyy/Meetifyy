-- Group invite links, and join requests that keep their answer.
--
-- 1. GroupInviteLink: a link (meetifyy.app/g/<code>) that lets someone outside
--    a group see it and join or ask to. Each lasts seven days, an admin's
--    reset revokes them all, and one stops working once its creator leaves.
--    Until now the shared "link" was the group's own address, which could
--    neither expire nor be revoked.
-- 2. ConversationJoinRequest keeps its row after an answer: who answered and
--    when. A decline used to delete the row, so a declined person could ask
--    again at once and nothing could say "Request declined".
-- 3. A pending request no longer lapses after 48 hours: it waits for an admin.
--
-- Additive and nullable, so the release before this one runs unchanged
-- against it: it reads only PENDING rows and deletes rows it answers, and it
-- never touches the new table. No CONCURRENTLY, no schema-qualified names.

-- AlterTable
ALTER TABLE "ConversationJoinRequest" ADD COLUMN "decidedAt" TIMESTAMP(3),
ADD COLUMN "decidedById" TEXT;

-- CreateTable
CREATE TABLE "GroupInviteLink" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(16) NOT NULL,
    "conversationId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "GroupInviteLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GroupInviteLink_code_key" ON "GroupInviteLink"("code");

-- CreateIndex
CREATE INDEX "GroupInviteLink_conversationId_revokedAt_idx" ON "GroupInviteLink"("conversationId", "revokedAt");

-- CreateIndex
CREATE INDEX "GroupInviteLink_createdById_idx" ON "GroupInviteLink"("createdById");

-- AddForeignKey
ALTER TABLE "ConversationJoinRequest" ADD CONSTRAINT "ConversationJoinRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupInviteLink" ADD CONSTRAINT "GroupInviteLink_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupInviteLink" ADD CONSTRAINT "GroupInviteLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Like every table since migration 30: closed to Supabase's Data API roles.
-- Prisma connects as the owner, which RLS does not apply to.
ALTER TABLE "GroupInviteLink" ENABLE ROW LEVEL SECURITY;

-- Requests that were left waiting: they wait for an answer now, not a clock.
UPDATE "ConversationJoinRequest"
SET "expiresAt" = NULL
WHERE "status" = 'PENDING';
