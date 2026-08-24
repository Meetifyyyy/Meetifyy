-- Clear cover images that were saved as blob: URLs.
--
-- A blob: URL is a pointer into the memory of the one browser tab that created
-- it. It dies with that tab, and it means nothing in any other browser. Saving
-- one to the database therefore produced a cover that can never load for
-- anyone — the viewer's console logs "Not allowed to load local resource" on
-- every render, for the life of the row.
--
-- Two rows reached production this way, one still carrying a LAN dev origin:
--   blob:http://192.168.137.1:3000/...
--   blob:http://localhost:3000/...
--
-- Nulling them is not data loss in any meaningful sense: the bytes those URLs
-- once pointed at were never uploaded anywhere, so the cover has been broken
-- since the moment it was saved. With the column null, the client falls back to
-- its deterministic default cover.
--
-- CreateActivityDto now rejects blob:/data: on the way in, so this is a one-off
-- cleanup rather than something that needs repeating.

UPDATE "CrewActivity"
SET "coverImage" = NULL
WHERE "coverImage" LIKE 'blob:%'
   OR "coverImage" LIKE 'data:%';
