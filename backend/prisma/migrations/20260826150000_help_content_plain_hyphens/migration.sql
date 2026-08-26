-- Normalise long dashes in help-centre content to plain hyphens.
--
-- The seed migrations wrote em dashes (U+2014) and en dashes (U+2013) into
-- article bodies and summaries. Help & Support copy is standardised on the
-- plain hyphen, so this rewrites the stored content in place.
--
-- Done as its own migration rather than by editing the seed files: those have
-- already been applied, and Prisma records a checksum for every applied
-- migration, so changing one in place makes `migrate deploy` fail on any
-- database that already ran it. Running after the seeds also means a fresh
-- database gets the corrected text without the seed content being duplicated.
--
-- Idempotent: replacing a character that is no longer present is a no-op, so
-- this is safe to re-run and safe for content an admin has since edited.

UPDATE "HelpArticle"
SET "question" = REPLACE(REPLACE("question", U&'\2014', '-'), U&'\2013', '-'),
    "summary"  = REPLACE(REPLACE("summary",  U&'\2014', '-'), U&'\2013', '-'),
    "body"     = REPLACE(REPLACE("body",     U&'\2014', '-'), U&'\2013', '-')
WHERE "question" ~ U&'[\2013\2014]'
   OR "summary"  ~ U&'[\2013\2014]'
   OR "body"     ~ U&'[\2013\2014]';

UPDATE "HelpCategory"
SET "title"       = REPLACE(REPLACE("title",       U&'\2014', '-'), U&'\2013', '-'),
    "description" = REPLACE(REPLACE("description", U&'\2014', '-'), U&'\2013', '-')
WHERE "title"       ~ U&'[\2013\2014]'
   OR "description" ~ U&'[\2013\2014]';
