-- Confession reactions: Love, Funny, Sad, Surprised, Relatable.
--
-- Additive only. The reaction is a new column on the existing relate table
-- with a default, so every relate already stored becomes RELATABLE (what it
-- always meant), and the previous release, which inserts relates without the
-- column, keeps working: its rows get the default. `Confession.relateCount`
-- stays the total across every kind, which is what that release reads.

-- CreateEnum
CREATE TYPE "ConfessionReactionType" AS ENUM ('LOVE', 'FUNNY', 'SAD', 'SURPRISED', 'RELATABLE');

-- AlterTable
ALTER TABLE "ConfessionRelate" ADD COLUMN "reaction" "ConfessionReactionType" NOT NULL DEFAULT 'RELATABLE';
