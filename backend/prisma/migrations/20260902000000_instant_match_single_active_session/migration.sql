-- One live Instant Match session per user, backed by the database.
--
-- The service refuses to finalize a second live session for either
-- participant, but two accepts landing on two replicas at the same instant are
-- not serialized by anything in application code. These partial unique indexes
-- make the second write fail rather than leave one user with two "active"
-- sessions — the state that made "which chat am I in?" ambiguous.
--
-- Scope, stated honestly: a unique index cannot span two columns as a single
-- key space, so this catches a user appearing twice in the same role (twice as
-- userA, or twice as userB). The remaining cross-column case — active once as
-- userA and once as userB — is still guarded only by the application check in
-- InstantMatchService.acceptSession. Closing it fully would need an exclusion
-- constraint over an unnested participant set (btree_gist), which is a heavier
-- change than the residual race warrants today.
--
-- Partial (WHERE) indexes are not expressible in the Prisma schema, so this is
-- hand-written; `prisma migrate` applies and tracks it like any other.
-- Existing rows first: any user already holding more than one live session
-- keeps the newest and has the rest marked expired. Without this the index
-- creation below would fail on exactly the data it exists to prevent.
UPDATE "MatchSession" AS m
SET "chatStatus" = 'EXPIRED', "endedAt" = NOW()
WHERE m."status" = 'ACCEPTED'
  AND m."chatStatus" = 'ACTIVE'
  AND EXISTS (
    SELECT 1 FROM "MatchSession" AS n
    WHERE n."status" = 'ACCEPTED'
      AND n."chatStatus" = 'ACTIVE'
      AND n."id" <> m."id"
      AND (n."userAId" IN (m."userAId", m."userBId")
        OR n."userBId" IN (m."userAId", m."userBId"))
      AND (n."createdAt" > m."createdAt"
        OR (n."createdAt" = m."createdAt" AND n."id" > m."id"))
  );

CREATE UNIQUE INDEX IF NOT EXISTS "MatchSession_active_userA_key"
  ON "MatchSession" ("userAId")
  WHERE "status" = 'ACCEPTED' AND "chatStatus" = 'ACTIVE';

CREATE UNIQUE INDEX IF NOT EXISTS "MatchSession_active_userB_key"
  ON "MatchSession" ("userBId")
  WHERE "status" = 'ACCEPTED' AND "chatStatus" = 'ACTIVE';
