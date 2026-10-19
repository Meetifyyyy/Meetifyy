-- Push notifications (web push + Android FCM). See docs/push-notifications.md.
--
-- Additive only, so a rollback of the image is safe: the previous release
-- neither reads nor writes the new table or columns, and never produces the
-- new enum values. The enum values are added with IF NOT EXISTS and are not
-- used anywhere in this migration (Postgres rejects using a value added in the
-- same transaction).

-- CreateEnum
CREATE TYPE "PushPlatform" AS ENUM ('WEB', 'ANDROID');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'COMMUNITY_JOIN';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'COMMUNITY_JOIN_REQUEST';

-- AlterTable: push-only category switches. Defaults keep every existing
-- user's behaviour (push is still gated by UserSettings.pushNotifs, default off).
ALTER TABLE "NotificationPreferences" ADD COLUMN     "pushActivities" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "pushComments" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "pushCommunities" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "pushFollows" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "pushLikes" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "pushMentions" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "pushMessages" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "PushDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" "PushPlatform" NOT NULL,
    "token" TEXT NOT NULL,
    "p256dh" TEXT,
    "auth" TEXT,
    "familyId" TEXT NOT NULL,
    "appVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "failureCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PushDevice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PushDevice_token_key" ON "PushDevice"("token");

-- CreateIndex
CREATE INDEX "PushDevice_userId_idx" ON "PushDevice"("userId");

-- CreateIndex
CREATE INDEX "PushDevice_familyId_idx" ON "PushDevice"("familyId");

-- CreateIndex
CREATE INDEX "PushDevice_lastSeenAt_idx" ON "PushDevice"("lastSeenAt");

-- AddForeignKey
ALTER TABLE "PushDevice" ADD CONSTRAINT "PushDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
