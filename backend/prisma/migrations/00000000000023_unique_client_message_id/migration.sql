-- One row per message a client sends, enforced by the database.
--
-- A message carries the sending client's id (`clientMessageId`), and every
-- send path already looks for an existing row with it before inserting, under
-- a per-id lock. This makes the database the final guarantee: two copies that
-- arrive together while the lock is unavailable (Redis down, two tabs flushing
-- the same outbox) can no longer both be written. The losing insert fails with
-- a unique violation, which the services answer with the row that won.
--
-- Production held no duplicate (senderId, clientMessageId) pairs when this was
-- written (checked 2026-10-22), so the index builds. NULL ids (system messages,
-- old clients) are distinct in a unique index and are unaffected.
--
-- Not CONCURRENTLY: Prisma runs each migration in a transaction (CLAUDE.md
-- 5b). Backward-compatible: the previous release already avoids duplicates and
-- never relies on inserting one.
DROP INDEX "Message_senderId_clientMessageId_idx";
CREATE UNIQUE INDEX "Message_senderId_clientMessageId_key" ON "Message"("senderId", "clientMessageId");
