-- "Later" on the Complete-your-profile prompt, kept server-side so it follows
-- the account across devices: snoozed until 10 days pass or the account signs
-- in again (a different session id).
--
-- Additive and nullable: the previous release neither reads nor writes either
-- column, so a rollback of the image is safe.
ALTER TABLE "User"
  ADD COLUMN "profilePromptLaterAt" TIMESTAMP(3),
  ADD COLUMN "profilePromptLaterSessionId" TEXT;
