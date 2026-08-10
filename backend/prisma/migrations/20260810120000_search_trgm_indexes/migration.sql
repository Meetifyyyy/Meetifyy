-- Trigram indexes to accelerate ILIKE/contains search across User, Community, Post, CrewActivity.
-- The 999999999999_fuzzy_search migration was recorded as applied but never actually created
-- these indexes on the live database, so we re-create the full set here (idempotent).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS user_username_trgm_idx ON "User" USING GIN (username gin_trgm_ops);
CREATE INDEX IF NOT EXISTS user_display_name_trgm_idx ON "User" USING GIN ("displayName" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS user_bio_trgm_idx ON "User" USING GIN (bio gin_trgm_ops);

CREATE INDEX IF NOT EXISTS community_name_trgm_idx ON "Community" USING GIN (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS community_slug_trgm_idx ON "Community" USING GIN (slug gin_trgm_ops);
CREATE INDEX IF NOT EXISTS community_description_trgm_idx ON "Community" USING GIN (description gin_trgm_ops);

CREATE INDEX IF NOT EXISTS post_text_trgm_idx ON "Post" USING GIN (text gin_trgm_ops);

CREATE INDEX IF NOT EXISTS crew_activity_title_trgm_idx ON "CrewActivity" USING GIN (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS crew_activity_description_trgm_idx ON "CrewActivity" USING GIN (description gin_trgm_ops);
CREATE INDEX IF NOT EXISTS crew_activity_location_trgm_idx ON "CrewActivity" USING GIN (location gin_trgm_ops);
