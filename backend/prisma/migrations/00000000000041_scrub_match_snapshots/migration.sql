-- Clear the stored queue requests of every Instant Match session that is no
-- longer pending (E-7 / IM-9).
--
-- `snapshotA` / `snapshotB` hold both people's queue request — campus, area,
-- latitude and longitude — so that a pending match can put them back in the
-- queue if it is declined or times out. The schema has always said they are
-- "cleared once the match is made", but nothing cleared them, so every past
-- match kept both people's location indefinitely. The service now clears them
-- when a session leaves PENDING; this clears the ones already stored.
--
-- A direct request keeps only its `{"requested": true}` marker. PENDING rows
-- are untouched: they still need their snapshots. Data only, no schema
-- change, and safe for the previous release, which reads snapshots only while
-- a session is PENDING.

UPDATE "MatchSession"
SET "snapshotA" = CASE
      WHEN jsonb_typeof("snapshotA") = 'object'
        AND "snapshotA"->>'requested' = 'true'
      THEN '{"requested": true}'::jsonb
      ELSE NULL
    END,
    "snapshotB" = NULL
WHERE "status" <> 'PENDING'
  AND ("snapshotA" IS NOT NULL OR "snapshotB" IS NOT NULL);
