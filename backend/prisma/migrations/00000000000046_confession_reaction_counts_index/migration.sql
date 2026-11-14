-- E-10: the per-kind reaction totals of a confession are read from an index.
--
-- A confessions page counts the reactions of its 20 confessions by kind, and
-- every reaction answers with the new totals. Both filtered by confession on
-- the primary key and then read each reaction row for its kind; on PGlite
-- with a synthetic page carrying 60,000 reactions, the page took 29 ms (the
-- planner chose a full scan) and became an index-only scan at 11.8 ms with
-- this index (one tap: 1.39 to 1.00 ms). The index is small (736 kB there,
-- against the primary key's 4.7 MB) because its keys repeat.
--
-- Plain CREATE INDEX (never CONCURRENTLY: Prisma runs each migration in a
-- transaction). Backward-compatible: nothing requires it.
CREATE INDEX IF NOT EXISTS "ConfessionRelate_confessionId_reaction_idx"
  ON "ConfessionRelate" ("confessionId", "reaction");
