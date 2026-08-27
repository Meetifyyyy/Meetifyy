-- AlterTable User: rename currentYear to passingYear (or add if missing)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'User' AND column_name = 'currentYear'
  ) THEN
    ALTER TABLE "User" RENAME COLUMN "currentYear" TO "passingYear";
  ELSE
    ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passingYear" INTEGER;
  END IF;
END $$;

-- Update Indexes
DROP INDEX IF EXISTS "User_collegeId_currentYear_idx";
CREATE INDEX IF NOT EXISTS "User_collegeId_passingYear_idx" ON "User" ("collegeId", "passingYear");
