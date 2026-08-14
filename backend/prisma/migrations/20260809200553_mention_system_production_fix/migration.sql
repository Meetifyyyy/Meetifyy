-- Mention system production fix
-- 1. Add MESSAGE as a valid mention source (chat mentions now tracked)
-- 2. Denormalize validated mentions onto Post/Comment for fast, server-authoritative rendering
-- 3. Add actorId to Mention for fast "who tagged me" lookups without a join
-- 4. Enforce uniqueness so retried mention inserts can never duplicate a notification

-- AlterEnum
ALTER TYPE "MentionSource" ADD VALUE 'MESSAGE';
