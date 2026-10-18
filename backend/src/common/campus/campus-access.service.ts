import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isCollegeOpen } from './campus-affiliation.util';

/**
 * The `select` that answers "does this user hold campus access, and to which
 * college?". Exported so a query that already loads the user can include it
 * instead of paying a second round-trip (see ActivitiesService.getViewer).
 */
export const ACTIVE_AFFILIATION_SELECT = {
  collegeId: true,
  revokedAt: true,
  college: { select: { isActive: true, status: true, deletedAt: true } },
} satisfies Prisma.CollegeAffiliationSelect;

export type AffiliationGateRow = Prisma.CollegeAffiliationGetPayload<{
  select: typeof ACTIVE_AFFILIATION_SELECT;
}>;

/** The college an affiliation row grants, or null when it grants nothing. */
export function activeAffiliationCollegeId(
  row: AffiliationGateRow | null | undefined,
): string | null {
  if (!row || row.revokedAt !== null) return null;
  return isCollegeOpen(row.college) ? row.collegeId : null;
}

export const CAMPUS_AFFILIATION_REQUIRED = 'campus_affiliation_required';

/**
 * Campus authorization.
 *
 * Campus features (the directory, campus communities, campus events, the
 * college-only activity slice) are gated on a verified college email — an
 * active `CollegeAffiliation` whose college is active, approved and not
 * deleted — and NOT on the selfie verification status. The college a campus
 * read is scoped to is always the one returned here, never a value from the
 * request.
 *
 * Deliberately uncached: it is one unique-index lookup, and an affiliation
 * that was just removed or revoked must stop working on the very next request
 * on every replica without an invalidation protocol to get wrong.
 */
@Injectable()
export class CampusAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** The college the user may act as a member of, or null. */
  async getActiveCollegeId(userId: string | null | undefined) {
    if (!userId) return null;
    const row = await this.prisma.collegeAffiliation.findUnique({
      where: { userId },
      select: ACTIVE_AFFILIATION_SELECT,
    });
    return activeAffiliationCollegeId(row);
  }

  async hasAffiliation(userId: string | null | undefined): Promise<boolean> {
    return (await this.getActiveCollegeId(userId)) !== null;
  }

  /** Throws 403 `{ code: 'campus_affiliation_required' }` without one. */
  async requireAffiliation(
    userId: string | null | undefined,
  ): Promise<{ collegeId: string }> {
    const collegeId = await this.getActiveCollegeId(userId);
    if (!collegeId) {
      throw new ForbiddenException({
        statusCode: 403,
        code: CAMPUS_AFFILIATION_REQUIRED,
        message: 'Verify your college email on the Campus page to continue.',
      });
    }
    return { collegeId };
  }
}
