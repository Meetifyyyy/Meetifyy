CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS user_username_trgm_idx ON "User" USING GIN (username gin_trgm_ops);
CREATE INDEX IF NOT EXISTS user_display_name_trgm_idx ON "User" USING GIN ("displayName" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS community_slug_trgm_idx ON "Community" USING GIN (slug gin_trgm_ops);
CREATE INDEX IF NOT EXISTS post_text_trgm_idx ON "Post" USING GIN (text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS crew_activity_title_trgm_idx ON "CrewActivity" USING GIN (title gin_trgm_ops);

