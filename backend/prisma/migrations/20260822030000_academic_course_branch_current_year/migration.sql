-- Replaces the legacy academic model (major + graduationYear) with the
-- Course -> Branch -> Current Year system sourced from GLA University's
-- official programme list.
--
-- Legacy data is DROPPED rather than mapped, by explicit product decision:
--   * `major` held one free-text value ("AI & Machine Learning") that does not
--     map unambiguously onto an official GLA course/branch pair.
--   * `graduationYear` is a year of passing, not a current academic year. Deriving
--     one from the other requires knowing the course duration, which the legacy
--     rows never recorded — any conversion would be invented data.
-- Affected users are left with NULL academic fields and are treated as having an
-- incomplete profile, which the application already handles: the UI prompts them
-- to choose, and nothing renders "undefined".

-- New fields. All nullable so existing rows stay valid and no default is invented.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "course"      TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "branch"      TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "currentYear" INTEGER;

-- Directory filters read collegeId + course/branch/currentYear; the old indexes
-- covered collegeId + major/graduationYear and are now dead weight.
DROP INDEX IF EXISTS "User_collegeId_major_idx";
DROP INDEX IF EXISTS "User_collegeId_graduationYear_idx";

CREATE INDEX IF NOT EXISTS "User_collegeId_course_idx"          ON "User" ("collegeId", "course");
CREATE INDEX IF NOT EXISTS "User_collegeId_course_branch_idx"   ON "User" ("collegeId", "course", "branch");
CREATE INDEX IF NOT EXISTS "User_collegeId_currentYear_idx"     ON "User" ("collegeId", "currentYear");

-- Remove the legacy columns and, with them, the legacy data.
ALTER TABLE "User" DROP COLUMN IF EXISTS "major";
ALTER TABLE "User" DROP COLUMN IF EXISTS "graduationYear";
