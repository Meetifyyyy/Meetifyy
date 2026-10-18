import type { AffiliationGateRow } from '../campus-access.service';

/**
 * The `collegeAffiliation` relation as `ACTIVE_AFFILIATION_SELECT` loads it,
 * for fakes of `user.findUnique`. `null` collegeId means "no affiliation".
 */
export function affiliatedWith(
  collegeId: string | null,
  overrides: Partial<AffiliationGateRow> = {},
): AffiliationGateRow | null {
  if (!collegeId) return null;
  return {
    collegeId,
    revokedAt: null,
    college: { isActive: true, status: 'APPROVED', deletedAt: null },
    ...overrides,
  };
}
