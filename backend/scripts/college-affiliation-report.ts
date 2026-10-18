/**
 * College-affiliation dry-run report. READ-ONLY.
 *
 * Classifies existing accounts against the legacy backfill rule in migration
 * 00000000000014_college_affiliation (see docs/college-affiliation.md) so the
 * outcome is known before the migration runs anywhere that matters:
 *
 *   would-backfill        collegeId set, not deleted, email domain maps to that
 *                         same college, normalized email unique
 *   domain-mismatch       collegeId set but the email domain maps to another
 *                         college, or to none
 *   duplicate-email       candidates sharing a normalized email (skipped)
 *   unconfirmed-email     would-backfill rows whose auth.users.email_confirmed_at
 *                         is null ('unknown' when auth.users is not readable)
 *   selfie-status         verificationStatus breakdown of would-backfill rows
 *   already-affiliated    rows already in "CollegeAffiliation" (0 / n/a before
 *                         the migration)
 *
 * Prints counts and user ids. Never prints an email address.
 *
 * There is NO write mode. Every statement runs inside a transaction declared
 * READ ONLY, so Postgres itself refuses any write this file could ever make.
 *
 * Usage (prints against whatever DATABASE_URL resolves to — development by
 * default, because importing @prisma/client loads backend/.env):
 *   npx ts-node scripts/college-affiliation-report.ts
 */
import { Prisma, PrismaClient } from '@prisma/client';

type IdRow = { id: string };
type CountRow = { key: string | null; count: number };

/** Same candidate set as the migration's backfill CTE. */
const CANDIDATES = Prisma.sql`
  SELECT
    u."id",
    u."verificationStatus"::text AS "verificationStatus",
    lower(trim(u."email")) AS "emailNormalized"
  FROM "User" u
  WHERE u."collegeId" IS NOT NULL
    AND u."deletedAt" IS NULL
    AND u."email" LIKE '%_@_%'
    AND EXISTS (
      SELECT 1 FROM "CollegeDomain" d
      WHERE d."collegeId" = u."collegeId"
        AND lower(trim(d."domain")) = split_part(lower(trim(u."email")), '@', 2)
    )
`;

function printIds(label: string, rows: IdRow[]): void {
  console.log(`\n${label}: ${rows.length}`);
  for (const row of rows) console.log(`  ${row.id}`);
}

async function report(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`SET TRANSACTION READ ONLY`;

  const [{ exists: tableExists }] = await tx.$queryRaw<
    Array<{ exists: boolean }>
  >`SELECT to_regclass('public."CollegeAffiliation"') IS NOT NULL AS "exists"`;

  const duplicates = await tx.$queryRaw<IdRow[]>`
    WITH c AS (${CANDIDATES}),
    d AS (SELECT c.*, count(*) OVER (PARTITION BY c."emailNormalized") AS n FROM c)
    SELECT "id" FROM d WHERE n > 1 ORDER BY "id"`;

  const affiliated = tableExists
    ? await tx.$queryRaw<IdRow[]>`
        SELECT "userId" AS "id" FROM "CollegeAffiliation" ORDER BY "userId"`
    : null;

  const wouldBackfill = await tx.$queryRaw<IdRow[]>`
    WITH c AS (${CANDIDATES}),
    d AS (SELECT c.*, count(*) OVER (PARTITION BY c."emailNormalized") AS n FROM c)
    SELECT "id" FROM d WHERE n = 1 ORDER BY "id"`;

  const pending = affiliated
    ? wouldBackfill.filter((r) => !affiliated.some((a) => a.id === r.id))
    : wouldBackfill;

  const mismatch = await tx.$queryRaw<IdRow[]>`
    SELECT u."id"
    FROM "User" u
    WHERE u."collegeId" IS NOT NULL
      AND u."deletedAt" IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM "CollegeDomain" d
        WHERE d."collegeId" = u."collegeId"
          AND lower(trim(d."domain")) = split_part(lower(trim(u."email")), '@', 2)
      )
    ORDER BY u."id"`;

  const selfie = await tx.$queryRaw<CountRow[]>`
    WITH c AS (${CANDIDATES}),
    d AS (SELECT c.*, count(*) OVER (PARTITION BY c."emailNormalized") AS n FROM c)
    SELECT "verificationStatus" AS "key", count(*)::int AS "count"
    FROM d WHERE n = 1 GROUP BY 1 ORDER BY 1`;

  // auth.users lives outside Prisma's schema and may not be readable with this
  // role. A failure is reported as 'unknown' rather than guessed at. The
  // savepoint keeps a failed probe from aborting the read-only transaction.
  let unconfirmed: IdRow[] | 'unknown' = 'unknown';
  try {
    await tx.$executeRaw`SAVEPOINT auth_probe`;
    unconfirmed = await tx.$queryRaw<IdRow[]>`
      WITH c AS (${CANDIDATES}),
      d AS (SELECT c.*, count(*) OVER (PARTITION BY c."emailNormalized") AS n FROM c)
      SELECT d."id"
      FROM d
      LEFT JOIN auth.users au ON au."id"::text = d."id"
      WHERE d.n = 1 AND (au."id" IS NULL OR au."email_confirmed_at" IS NULL)
      ORDER BY d."id"`;
    await tx.$executeRaw`RELEASE SAVEPOINT auth_probe`;
  } catch {
    await tx.$executeRaw`ROLLBACK TO SAVEPOINT auth_probe`;
  }

  console.log('College affiliation dry-run report (read-only)');
  console.log(
    `CollegeAffiliation table: ${tableExists ? 'present' : 'absent (migration not applied)'}`,
  );
  printIds('would-backfill (pending)', pending);
  printIds(
    'domain-mismatch (collegeId set, email domain maps to another or no college)',
    mismatch,
  );
  printIds('duplicate-email (skipped by the backfill)', duplicates);
  if (unconfirmed === 'unknown') {
    console.log('\nunconfirmed-email: unknown (auth.users not readable)');
  } else {
    printIds(
      'unconfirmed-email (would-backfill without a confirmed auth email; must be 0 before production)',
      unconfirmed,
    );
  }
  console.log('\nselfie-status of would-backfill rows:');
  for (const row of selfie) console.log(`  ${row.key ?? 'NULL'}: ${row.count}`);
  if (affiliated) {
    printIds('already-affiliated', affiliated);
  } else {
    console.log('\nalready-affiliated: n/a (table absent)');
  }
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await prisma.$transaction((tx) => report(tx), { timeout: 120_000 });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
