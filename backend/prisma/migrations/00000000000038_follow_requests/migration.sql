-- Follow requests for private accounts.
--
-- Additive only, so a rollback of the image is safe: the previous release never
-- reads or writes the new table and never produces the new enum values. The
-- enum values are added with IF NOT EXISTS and are not used anywhere in this
-- migration (Postgres rejects using a value added in the same transaction).
-- Two values are added in one file, which needs Postgres 12+ inside a
-- transaction; every supported environment is newer than that.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'FOLLOW_REQUEST';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'FOLLOW_ACCEPTED';

-- CreateTable
CREATE TABLE "FollowRequest" (
    "requesterId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FollowRequest_pkey" PRIMARY KEY ("requesterId","targetId")
);

-- CreateIndex
CREATE INDEX "FollowRequest_targetId_createdAt_idx" ON "FollowRequest"("targetId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "FollowRequest" ADD CONSTRAINT "FollowRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowRequest" ADD CONSTRAINT "FollowRequest_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
