-- First-year separation was removed, so the help article explaining it is now
-- false. Archived rather than deleted: an admin can still see and reuse it.
UPDATE "HelpArticle"
SET "status" = 'ARCHIVED', "updatedAt" = NOW()
WHERE "slug" = 'why-cant-i-find-some-students' AND "status" = 'PUBLISHED';
