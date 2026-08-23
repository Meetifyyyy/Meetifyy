-- INSTANT_MATCH becomes a first-class ConversationType.
--
-- Alone in its own migration on purpose: Postgres refuses to USE a new enum
-- value in the same transaction that adds it ("unsafe use of new value of enum
-- type"), and Prisma wraps each migration in one transaction. The backfill
-- that moves existing rows onto this value therefore lives in the next
-- migration, which runs in a separate transaction.
ALTER TYPE "ConversationType" ADD VALUE IF NOT EXISTS 'INSTANT_MATCH';
