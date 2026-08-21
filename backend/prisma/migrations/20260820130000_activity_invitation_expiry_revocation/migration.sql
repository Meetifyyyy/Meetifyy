-- Activity invitations gain an optional hard expiry and an explicit revocation
-- timestamp. Both are consulted by the server-side activity access policy, so a
-- PENDING-but-expired or PENDING-but-revoked invitation grants no access.
ALTER TABLE "ActivityInvitation" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3);
ALTER TABLE "ActivityInvitation" ADD COLUMN IF NOT EXISTS "revokedAt" TIMESTAMP(3);

-- No new index: the existing [activityId, inviteeId, status] index already
-- serves the "is there a live invitation for (activity, invitee)?" lookup, and
-- revokedAt/expiresAt are only read off the matched row.
