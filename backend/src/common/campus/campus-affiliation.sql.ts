import { Prisma } from '@prisma/client';

/**
 * Raw-SQL forms of the campus-access rule, for ranking queries that already
 * run as raw SQL. They mirror `activeAffiliationCollegeId` /
 * `isCollegeOpen` exactly: an affiliation grants its college only while it is
 * not revoked and the college is active, approved and not deleted.
 *
 * Both are single lookups on unique/indexed columns (`CollegeAffiliation`
 * `userId` UNIQUE, `College` primary key), so they cost one index probe per
 * row they are evaluated for.
 */

/**
 * Scalar subquery: the college `userIdExpr` holds campus access to, or NULL.
 * `userIdExpr` is an SQL expression (a column reference or a bound value).
 */
export function activeAffiliationCollegeIdSql(
  userIdExpr: Prisma.Sql,
): Prisma.Sql {
  return Prisma.sql`(
    SELECT a."collegeId"
    FROM "CollegeAffiliation" a
    JOIN "College" ac ON ac."id" = a."collegeId"
    WHERE a."userId" = ${userIdExpr}
      AND a."revokedAt" IS NULL
      AND ac."isActive" = true
      AND ac."status" = 'APPROVED'
      AND ac."deletedAt" IS NULL
  )`;
}

/**
 * Boolean: `userIdExpr` holds an active (not revoked) affiliation to
 * `collegeIdExpr`. Used for the candidate side of a same-college boost, where
 * `collegeIdExpr` is the viewer's already-checked open college — so the
 * college's own state needs no second check here. NULL `collegeIdExpr`
 * yields false.
 */
export function affiliatedToCollegeSql(
  userIdExpr: Prisma.Sql,
  collegeIdExpr: Prisma.Sql,
): Prisma.Sql {
  return Prisma.sql`EXISTS (
    SELECT 1 FROM "CollegeAffiliation" a
    WHERE a."userId" = ${userIdExpr}
      AND a."revokedAt" IS NULL
      AND a."collegeId" = ${collegeIdExpr}
  )`;
}
