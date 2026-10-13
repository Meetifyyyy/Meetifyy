-- Nothing wrote "PostHashtag" until posts.service started indexing hashtags on
-- create, so existing posts have none. This indexes them once.
--
-- Mirrors src/posts/hashtags.util.ts as closely as POSIX classes allow: `#` and
-- 2-50 letters/digits/underscores with at least one letter, not glued to a
-- word, URL path or entity. Data only and idempotent (ON CONFLICT DO NOTHING),
-- so it is safe to run on a database that already has some rows.

INSERT INTO "Hashtag" ("id", "name", "postCount", "createdAt")
SELECT gen_random_uuid(), t.name, 0, NOW()
FROM (
  SELECT DISTINCT lower(m[2]) AS name
  FROM "Post" p,
       regexp_matches(p."text", '(^|[^[:alnum:]_&/#])#([[:alnum:]_]{2,50})(?![[:alnum:]_])', 'g') AS m
  WHERE p."deletedAt" IS NULL
) t
WHERE t.name ~ '[[:alpha:]]'
ON CONFLICT ("name") DO NOTHING;

INSERT INTO "PostHashtag" ("postId", "hashtagId")
SELECT DISTINCT p."id", h."id"
FROM "Post" p,
     regexp_matches(p."text", '(^|[^[:alnum:]_&/#])#([[:alnum:]_]{2,50})(?![[:alnum:]_])', 'g') AS m
JOIN "Hashtag" h ON h."name" = lower(m[2])
WHERE p."deletedAt" IS NULL
ON CONFLICT DO NOTHING;

UPDATE "Hashtag" h
SET "postCount" = (
  SELECT COUNT(*) FROM "PostHashtag" ph WHERE ph."hashtagId" = h."id"
);
