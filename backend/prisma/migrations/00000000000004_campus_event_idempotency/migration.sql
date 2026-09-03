-- Idempotency for campus event creation.
--
-- POST /api/campus-events had no way to tell a retry from a new event: a
-- double-submit, or a client retrying after a timeout on a request the server
-- had in fact committed, produced two events. The column below carries a
-- client-generated key (one per Create-Event dialog) and the unique index makes
-- the second insert fail loudly instead of succeeding quietly, so the service
-- can return the event the first attempt created.
--
-- Nullable on purpose: existing rows get NULL, and Postgres treats NULLs as
-- distinct in a unique index, so no backfill is required and any caller that
-- omits the key keeps working exactly as before.
ALTER TABLE "CampusEvent" ADD COLUMN "idempotencyKey" TEXT;

-- Not CONCURRENTLY: Prisma wraps each migration in a transaction and Postgres
-- rejects CREATE INDEX CONCURRENTLY there (SQLSTATE 25001).
CREATE UNIQUE INDEX "CampusEvent_createdBy_idempotencyKey_key"
  ON "CampusEvent" ("createdBy", "idempotencyKey");
