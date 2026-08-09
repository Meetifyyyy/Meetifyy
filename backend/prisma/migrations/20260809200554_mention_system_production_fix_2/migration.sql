-- Mention system production fix (part 2 — split from the enum-add migration
-- because Postgres forbids using a newly added enum value in the same
-- transaction that created it).

-- AlterTable
ALTER TABLE "Comment" ADD COLUMN     "mentions" JSONB;

-- AlterTable
ALTER TABLE "Mention" ADD COLUMN     "actorId" TEXT;

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "mentions" JSONB;

-- CreateIndex
CREATE INDEX "Mention_userId_createdAt_idx" ON "Mention"("userId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Mention_userId_sourceType_sourceId_key" ON "Mention"("userId", "sourceType", "sourceId");
