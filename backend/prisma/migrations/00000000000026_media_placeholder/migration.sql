-- A tiny blurred preview of an image, shown while the real one loads.
-- Nullable and additive: the previous release neither reads nor writes it.
ALTER TABLE "Media" ADD COLUMN "placeholder" TEXT;
