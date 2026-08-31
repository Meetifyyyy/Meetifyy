-- Drop the vestigial email-verification flag.
--
-- Real email confirmation is owned and enforced by Supabase: auth.service
-- refuses to create a user row without `email_confirmed_at`, so every row in
-- this table is confirmed by construction. This column was never written by
-- any signup or login path — only by an admin button — so it reported
-- "unverified" for accounts that were, necessarily, verified.
--
-- Identity verification lives in User.verificationStatus and is unaffected.
ALTER TABLE "User" DROP COLUMN "emailVerified";
