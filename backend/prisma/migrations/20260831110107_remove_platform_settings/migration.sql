-- Remove the Platform Settings store.
--
-- The table was written by the admin page and read by nothing: `systemSetting`
-- appeared only in the admin list and upsert, so no application behaviour ever
-- consulted a value stored here. Runtime configuration lives in environment
-- variables, which are version-controlled and part of a rollback.
DROP TABLE IF EXISTS "SystemSetting";
