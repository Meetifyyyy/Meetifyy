-- UserSession: a signed-in device, and the ability to revoke one.
--
-- Access tokens were pure bearer credentials with no server-side record. A copy
-- taken off a device kept working, and kept refreshing itself, until it expired;
-- signing out cleared one browser and nothing else. This table is what makes
-- "sign out this device" and "sign out everywhere" mean something.

CREATE TYPE "UserSessionRevokedReason" AS ENUM (
  'USER_LOGOUT',
  'USER_LOGOUT_ALL',
  'USER_REVOKED_DEVICE',
  'PASSWORD_CHANGED',
  'REFRESH_REPLAY',
  'ADMIN_REVOKED',
  'ACCOUNT_DELETED'
);

CREATE TABLE "UserSession" (
  "id"            TEXT NOT NULL,
  "userId"        TEXT NOT NULL,
  "refreshHash"   TEXT NOT NULL,
  "familyId"      TEXT NOT NULL,
  "replacedById"  TEXT,
  "ip"            TEXT,
  "userAgent"     TEXT,
  "deviceName"    TEXT,
  "browser"       TEXT,
  "os"            TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastActiveAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt"     TIMESTAMP(3) NOT NULL,
  "revoked"       BOOLEAN NOT NULL DEFAULT false,
  "revokedAt"     TIMESTAMP(3),
  "revokedReason" "UserSessionRevokedReason",

  CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserSession_refreshHash_key" ON "UserSession"("refreshHash");

-- The device list, newest first.
CREATE INDEX "UserSession_userId_revoked_lastActiveAt_idx"
  ON "UserSession"("userId", "revoked", "lastActiveAt" DESC);

-- Replay detection revokes a whole rotation family at once.
CREATE INDEX "UserSession_familyId_idx" ON "UserSession"("familyId");

-- The expiry sweep.
CREATE INDEX "UserSession_expiresAt_idx" ON "UserSession"("expiresAt");

ALTER TABLE "UserSession"
  ADD CONSTRAINT "UserSession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The provider's refresh token, sealed. Held server-side so the browser does
-- not have to, and encrypted so the table is not a set of live credentials.
ALTER TABLE "UserSession" ADD COLUMN "providerRefresh" TEXT;
