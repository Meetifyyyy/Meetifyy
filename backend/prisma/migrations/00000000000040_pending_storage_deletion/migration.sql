-- Storage objects owed a delete (security finding ID-4).
--
-- An account purge deleted the person's media rows in its transaction and then
-- tried the storage deletes in process memory, three times. A restart or a
-- storage outage in that window left their files in the bucket with no row
-- pointing at them. The purge now writes the keys here in the same transaction,
-- and a sweep deletes each object and then its row.
--
-- Additive only, so a rollback of the image is safe: the previous release never
-- reads or writes this table.

-- CreateTable
CREATE TABLE "PendingStorageDeletion" (
    "objectKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,

    CONSTRAINT "PendingStorageDeletion_pkey" PRIMARY KEY ("objectKey")
);

-- CreateIndex
CREATE INDEX "PendingStorageDeletion_nextAttemptAt_idx" ON "PendingStorageDeletion"("nextAttemptAt");

-- Like every table since migration 30: closed to Supabase's Data API roles.
-- Prisma connects as the owner, which RLS does not apply to.
ALTER TABLE "PendingStorageDeletion" ENABLE ROW LEVEL SECURITY;

-- FollowRequest (migration 38) was created without this line. The API roles
-- already hold no privilege on it (migration 30 removed the default grants);
-- this restores the second layer every other table has. A no-op if already on.
ALTER TABLE "FollowRequest" ENABLE ROW LEVEL SECURITY;
