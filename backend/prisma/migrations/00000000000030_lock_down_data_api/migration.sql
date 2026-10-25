-- Close Supabase's Data API (PostgREST) over this schema.
--
-- Nothing in this app reads or writes the database through the Data API: the
-- backend uses Prisma, and every client goes through the backend. But Supabase
-- gives `anon` and `authenticated` full privileges on every table created in
-- `public` (default privileges FOR ROLE postgres), RLS was never enabled, and
-- the anon key ships in every browser bundle. So anyone could read, change or
-- delete any row over REST, User rows and the ConfessionProfile mapping from
-- an account to its anonymous handle included.
--
-- 1. RLS on, with no policies: `anon` and `authenticated` see no rows even if
--    a grant ever comes back. Prisma connects as `postgres`, the owner of
--    these tables, which RLS does not apply to (no FORCE), and `service_role`
--    bypasses RLS, so neither is affected.
-- 2. The two API roles lose every privilege on existing tables and sequences.
-- 3. Tables, sequences and functions created by later migrations no longer
--    get those privileges by default.
--
-- Additive and reversible (GRANT / DISABLE restore the old state), and the
-- previous release does not use either role. Only tables the migrating role
-- owns are touched, so a table owned by someone else cannot fail it, and the
-- role checks keep the folder building from empty on plain Postgres.

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = current_schema() AND tableowner = current_user
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', current_schema(), t.tablename);
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    FOR t IN
      SELECT tablename FROM pg_tables
      WHERE schemaname = current_schema() AND tableowner = current_user
    LOOP
      EXECUTE format('REVOKE ALL ON TABLE %I.%I FROM anon, authenticated', current_schema(), t.tablename);
    END LOOP;
    EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM anon, authenticated', current_schema());
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I REVOKE ALL ON TABLES FROM anon, authenticated', current_schema());
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I REVOKE ALL ON SEQUENCES FROM anon, authenticated', current_schema());
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I REVOKE ALL ON FUNCTIONS FROM anon, authenticated', current_schema());
  END IF;
END $$;
