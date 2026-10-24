-- Email change security: reauthentication grants, the email-change history the
-- 30-day cooldowns are computed from, and a guard on Supabase Auth's own
-- email-change path.
--
-- Additive only. Three new tables, three new enums and a new UserOtpPurpose
-- value this migration does not use (Postgres forbids using an enum value in
-- the transaction that adds it). The previous release reads and writes none of
-- it, and the auth.users trigger refuses only email writes that the previous
-- release never makes either (it changes the auth email solely through the
-- admin API, inside the flow that now registers an intent first — see the
-- deployment note in docs/email-change-security.md).

-- CreateEnum
CREATE TYPE "ReauthPurpose" AS ENUM ('PERSONAL_EMAIL_CHANGE', 'COLLEGE_EMAIL_CHANGE', 'COLLEGE_EMAIL_REMOVE');

-- CreateEnum
CREATE TYPE "EmailChannel" AS ENUM ('PERSONAL', 'COLLEGE');

-- CreateEnum
CREATE TYPE "EmailChangeAction" AS ENUM ('CHANGE', 'ADD', 'REMOVE', 'ADMIN_REVOKE', 'ADMIN_RELEASE');

-- AlterEnum
ALTER TYPE "UserOtpPurpose" ADD VALUE 'REAUTH';

-- CreateTable
CREATE TABLE "EmailChangeEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" "EmailChannel" NOT NULL,
    "action" "EmailChangeAction" NOT NULL,
    "countsTowardCooldown" BOOLEAN NOT NULL,
    "previousEmail" TEXT,
    "newEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailChangeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReauthGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" "ReauthPurpose" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "sessionId" TEXT,
    "method" VARCHAR(16) NOT NULL,
    "target" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReauthGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthEmailChangeIntent" (
    "userId" TEXT NOT NULL,
    "previousEmail" TEXT NOT NULL,
    "newEmail" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthEmailChangeIntent_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "EmailChangeEvent_userId_channel_createdAt_idx" ON "EmailChangeEvent"("userId", "channel", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReauthGrant_tokenHash_key" ON "ReauthGrant"("tokenHash");

-- CreateIndex
CREATE INDEX "ReauthGrant_userId_purpose_idx" ON "ReauthGrant"("userId", "purpose");

-- CreateIndex
CREATE INDEX "ReauthGrant_expiresAt_idx" ON "ReauthGrant"("expiresAt");

-- AddForeignKey
ALTER TABLE "EmailChangeEvent" ADD CONSTRAINT "EmailChangeEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReauthGrant" ADD CONSTRAINT "ReauthGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthEmailChangeIntent" ADD CONSTRAINT "AuthEmailChangeIntent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- The Data API roles never see these tables, matching 00000000000028: RLS on
-- with no policies, and no grants (the default privileges revoked there already
-- cover tables created later; the REVOKE is explicit so it holds even where
-- that migration's role checks skipped).
ALTER TABLE "EmailChangeEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReauthGrant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuthEmailChangeIntent" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "EmailChangeEvent", "ReauthGrant", "AuthEmailChangeIntent"
      FROM anon, authenticated;
  END IF;
END $$;

-- Supabase Auth email guard.
--
-- A signed-in client holds a Supabase access token and the public anon key, so
-- it can call `PUT /auth/v1/user {"email": ...}` directly. That path would
-- change the sign-in address with no reauthentication, no 30-day cooldown and
-- no record here, and `User.email` would silently disagree with Supabase.
-- Supabase has no setting that turns user-initiated email changes off, so the
-- database refuses them:
--
--   1. `email_change` is the column GoTrue stages a self-service change in
--      before the confirmation mail. Writing a non-empty value is refused, so
--      the request fails and no link that could later confirm it is stored.
--   2. `email` may change only while an AuthEmailChangeIntent names exactly
--      that address for that user and has not expired. The backend writes the
--      intent, then calls the admin API, then clears it.
--
-- Installed only in the `public` schema of a database that has `auth.users`,
-- so a plain-Postgres build from empty and the scratch-schema check in
-- CLAUDE.md (5b) both skip it and never touch the real auth table. If the
-- migrating role may not create the trigger, the migration still succeeds and
-- says so: a failed migration blocks every later one (P3009), and the backend
-- checks for the trigger at boot and logs an error when it is missing.
DO $$
BEGIN
  IF current_schema() <> 'public' OR to_regclass('auth.users') IS NULL THEN
    RAISE NOTICE 'auth email guard not installed (schema %, auth.users %)',
      current_schema(), to_regclass('auth.users');
    RETURN;
  END IF;

  BEGIN
    CREATE OR REPLACE FUNCTION public.meetifyy_guard_auth_email_change()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = ''
    AS $fn$
    BEGIN
      IF NEW.email_change IS DISTINCT FROM OLD.email_change
         AND COALESCE(NEW.email_change, '') <> '' THEN
        RAISE EXCEPTION 'Email changes must be made in Meetifyy settings'
          USING ERRCODE = '42501';
      END IF;

      IF NEW.email IS DISTINCT FROM OLD.email AND NOT EXISTS (
        SELECT 1 FROM public."AuthEmailChangeIntent" i
        WHERE i."userId" = NEW.id::text
          AND lower(i."newEmail") = lower(COALESCE(NEW.email, ''))
          AND i."expiresAt" > timezone('utc', now())
      ) THEN
        RAISE EXCEPTION 'Email changes must be made in Meetifyy settings'
          USING ERRCODE = '42501';
      END IF;

      RETURN NEW;
    END;
    $fn$;

    REVOKE ALL ON FUNCTION public.meetifyy_guard_auth_email_change() FROM PUBLIC;

    DROP TRIGGER IF EXISTS meetifyy_guard_auth_email_change ON auth.users;
    CREATE TRIGGER meetifyy_guard_auth_email_change
      BEFORE UPDATE OF email, email_change ON auth.users
      FOR EACH ROW
      WHEN (OLD.email IS DISTINCT FROM NEW.email
            OR OLD.email_change IS DISTINCT FROM NEW.email_change)
      EXECUTE FUNCTION public.meetifyy_guard_auth_email_change();
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE WARNING 'auth email guard NOT installed: % (install it as a role that may create triggers on auth.users)', SQLERRM;
  END;
END $$;
