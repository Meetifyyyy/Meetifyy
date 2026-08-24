-- Block: forbid self-blocks at the database level.
--
-- The application already rejects this in UsersService.blockUser, but that
-- guard only covers the one code path that happens to call it. A CHECK
-- constraint holds for every writer — a second service, a backfill script, a
-- manual psql session — and a self-block row is corrupting rather than merely
-- odd: getExcludedUserIds would return the user's own id, filtering the user
-- out of their own feed, search results and member lists.
--
-- Idempotent so re-running against a database that already has it is a no-op.
-- Prisma cannot express CHECK constraints in schema.prisma, so this lives as a
-- raw migration; `prisma migrate deploy` applies it in filename order like any
-- other, and it is not lost on future `migrate dev` runs.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'no_self_block'
  ) THEN
    -- Clear any pre-existing violations first, or ADD CONSTRAINT fails on a
    -- database that already accumulated one.
    DELETE FROM "Block" WHERE "blockerId" = "blockedId";

    ALTER TABLE "Block"
      ADD CONSTRAINT "no_self_block"
      CHECK ("blockerId" <> "blockedId");
  END IF;
END
$$;
