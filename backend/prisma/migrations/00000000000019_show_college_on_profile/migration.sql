-- Lets a user hide the college and course tags on their own profile.
--
-- Additive with a default: the previous release neither reads nor writes the
-- column and every existing row keeps showing the tags, so a rollback of the
-- image is safe.
ALTER TABLE "UserSettings"
  ADD COLUMN "showCollegeOnProfile" BOOLEAN NOT NULL DEFAULT true;
