-- Anonymous confessions. Additive only: three new tables, a new enum, and a
-- new ReportTargetType value that this migration does not itself use (Postgres
-- forbids using an enum value in the transaction that adds it). The previous
-- release neither reads nor writes any of it.

-- CreateEnum
CREATE TYPE "ConfessionStatus" AS ENUM ('VISIBLE', 'HIDDEN', 'REMOVED');

-- AlterEnum
ALTER TYPE "ReportTargetType" ADD VALUE 'CONFESSION';

-- CreateTable
CREATE TABLE "ConfessionProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "handle" VARCHAR(20) NOT NULL,
    "handleKey" VARCHAR(20) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConfessionProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Confession" (
    "id" TEXT NOT NULL,
    "collegeId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "contentHash" VARCHAR(64) NOT NULL,
    "status" "ConfessionStatus" NOT NULL DEFAULT 'VISIBLE',
    "relateCount" INTEGER NOT NULL DEFAULT 0,
    "reportCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Confession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfessionRelate" (
    "confessionId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConfessionRelate_pkey" PRIMARY KEY ("confessionId","profileId")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConfessionProfile_userId_key" ON "ConfessionProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ConfessionProfile_handleKey_key" ON "ConfessionProfile"("handleKey");

-- CreateIndex
CREATE INDEX "Confession_collegeId_status_createdAt_id_idx" ON "Confession"("collegeId", "status", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "Confession_profileId_createdAt_idx" ON "Confession"("profileId", "createdAt");

-- CreateIndex
CREATE INDEX "ConfessionRelate_profileId_idx" ON "ConfessionRelate"("profileId");

-- AddForeignKey
ALTER TABLE "ConfessionProfile" ADD CONSTRAINT "ConfessionProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Confession" ADD CONSTRAINT "Confession_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "College"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Confession" ADD CONSTRAINT "Confession_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "ConfessionProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfessionRelate" ADD CONSTRAINT "ConfessionRelate_confessionId_fkey" FOREIGN KEY ("confessionId") REFERENCES "Confession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfessionRelate" ADD CONSTRAINT "ConfessionRelate_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "ConfessionProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

