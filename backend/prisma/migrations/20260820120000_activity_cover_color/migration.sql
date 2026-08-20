-- Adds a solid-colour cover mode to CrewActivity.
-- An activity's cover is either an image (coverImage / coverMediaId) or a solid
-- colour (coverColor). The two modes are mutually exclusive: writing one clears
-- the other, so a colour cover can never retain a stale image reference.
ALTER TABLE "CrewActivity" ADD COLUMN "coverColor" TEXT;
