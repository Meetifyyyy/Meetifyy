-- Puts PENDING_DELETION in its correct lifecycle position, before DELETED.
--
-- WHY THIS NEEDS A REWRITE
-- `ALTER TYPE ... ADD VALUE` appends, so when PENDING_DELETION was introduced
-- it landed AFTER the terminal DELETED state. Postgres sorts an enum by
-- declaration order, so `ORDER BY "accountStatus"` would put a recoverable
-- account after a permanently deleted one. Nothing sorts by this column today —
-- which is exactly why this is worth correcting now: the cost is a rewrite of a
-- 13-row table, and it only ever grows from here. Left alone, the first query
-- that does sort by it would be quietly wrong.
--
-- WHY THIS IS SAFE
-- Prisma runs each migration inside a transaction, so this is all-or-nothing:
-- a failure at any step leaves the old type and column exactly as they were.
-- The rename-swap-drop sequence is the standard Postgres idiom for reordering
-- an enum; the USING cast goes via text, so every existing value is preserved
-- by name rather than by ordinal. The two indexes on the column are rebuilt
-- automatically by the type change.
--
-- LOCKING
-- Step 4 takes an ACCESS EXCLUSIVE lock on "User" and rewrites the table. At
-- the current size (13 rows / 296 kB) that is sub-millisecond. Anyone applying
-- this to a substantially larger database should check that assumption first.

-- 1. Move the existing type aside.
ALTER TYPE "AccountStatus" RENAME TO "AccountStatus_old";

-- 2. Create the replacement, in lifecycle order.
CREATE TYPE "AccountStatus" AS ENUM (
  'ACTIVE',
  'SUSPENDED',
  'BANNED',
  'PENDING_DELETION',
  'DELETED'
);

-- 3. The default has to go first: a column default cannot be cast in place.
ALTER TABLE "User" ALTER COLUMN "accountStatus" DROP DEFAULT;

-- 4. Convert the data. Casting through text matches values by NAME, so nothing
--    depends on the ordinals that are being changed.
ALTER TABLE "User"
  ALTER COLUMN "accountStatus" TYPE "AccountStatus"
  USING "accountStatus"::text::"AccountStatus";

-- 5. Restore the default, now expressed in the new type.
ALTER TABLE "User" ALTER COLUMN "accountStatus" SET DEFAULT 'ACTIVE';

-- 6. Nothing references the old type any more.
DROP TYPE "AccountStatus_old";
