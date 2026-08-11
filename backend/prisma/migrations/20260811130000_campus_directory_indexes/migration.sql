-- Campus directory filter indexes.
-- Query pattern (backend/src/users/users.service.ts getDirectory):
--   WHERE "collegeId" = $1 AND "major" = $2            ORDER BY "createdAt" DESC, "id" DESC
--   WHERE "collegeId" = $1 AND "graduationYear" = $3   ORDER BY "createdAt" DESC, "id" DESC
-- These bound the per-college scan when the directory is filtered by major/year.
-- IF NOT EXISTS keeps the migration idempotent across environments.

CREATE INDEX IF NOT EXISTS "User_collegeId_major_idx" ON "User" ("collegeId", "major");
CREATE INDEX IF NOT EXISTS "User_collegeId_graduationYear_idx" ON "User" ("collegeId", "graduationYear");
