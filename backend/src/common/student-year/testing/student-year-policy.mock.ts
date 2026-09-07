import { StudentYearPolicyService } from '../student-year-policy.service';

/**
 * Test double for the first-year isolation policy.
 *
 * Defaults to "everyone is compatible" so the existing suites — which are
 * about blocks, verification, routing and deletion, not batch years — keep
 * exercising the behaviour they were written for. Pass a `{ userId: batchYear }`
 * map to make the policy bite.
 *
 * `currentYear` defaults to 2026 rather than the wall clock so a suite written
 * against it does not start failing on 1 January.
 */
export function createStudentYearPolicyMock(
  batchYears: Record<string, number | null> = {},
  currentYear = 2026,
) {
  const batchOf = (id: string): number | null =>
    Object.prototype.hasOwnProperty.call(batchYears, id)
      ? batchYears[id]
      : null;
  const isFirstYear = (batch: number | null) => batch === currentYear;
  const compatible = (a: number | null, b: number | null) =>
    isFirstYear(a) === isFirstYear(b);

  return {
    isEnforcementEnabled: jest.fn(() => true),
    getCurrentAcademicYear: jest.fn(() => currentYear),
    getUserBatchYear: jest.fn(
      (user: any) => user?.batchYear ?? batchOf(user?.id) ?? null,
    ),
    deriveBatchYearForStorage: jest.fn(() => null),
    isFirstYearBatch: jest.fn((batch: number | null | undefined) =>
      isFirstYear(batch ?? null),
    ),
    isFirstYearStudent: jest.fn((user: any) =>
      isFirstYear(user?.batchYear ?? batchOf(user?.id) ?? null),
    ),
    areBatchYearsCompatible: jest.fn((a: number | null, b: number | null) =>
      compatible(a, b),
    ),
    canUsersInteract: jest.fn((a: any, b: any) =>
      compatible(
        a?.batchYear ?? batchOf(a?.id) ?? null,
        b?.batchYear ?? batchOf(b?.id) ?? null,
      ),
    ),
    canUserSeeUser: jest.fn(() => true),
    canUserSeeActivity: jest.fn(() => true),
    canUserAppearInNewMessageModal: jest.fn(() => true),
    canUserAppearInShareModal: jest.fn(() => true),
    canUserAppearInInviteModal: jest.fn(() => true),
    canCreateMessage: jest.fn(() => true),
    canUsersMatch: jest.fn(() => true),
    visibleUserWhere: jest.fn(() => ({})),
    // Returns the caller's `where` untouched, so a suite that is not about
    // batch years sees exactly the query it was written against.
    injectUserFilter: jest.fn((where: any) => where),
    visibleRelationWhere: jest.fn(() => ({})),
    visibleUserSqlPredicate: jest.fn(() => 'TRUE'),
    invalidate: jest.fn(),
    invalidateAll: jest.fn(),
    getBatchYearMap: jest.fn(async (ids: string[]) => {
      const map = new Map<string, number | null>();
      (ids || []).filter(Boolean).forEach((id) => map.set(id, batchOf(id)));
      return map;
    }),
    resolveContext: jest.fn(async (id: string) =>
      id
        ? { id, batchYear: batchOf(id), isFirstYear: isFirstYear(batchOf(id)) }
        : null,
    ),
    getBatchYearFor: jest.fn(async (id: string) => batchOf(id)),
    canIdsInteract: jest.fn(async (a: string, b: string) =>
      compatible(batchOf(a), batchOf(b)),
    ),
    getIncompatibleUserIds: jest.fn(async (actorId: string, ids: string[]) =>
      (ids || []).filter(
        (id) => id !== actorId && !compatible(batchOf(actorId), batchOf(id)),
      ),
    ),
    filterInteractableUserIds: jest.fn(
      async (actorId: string, ids: string[]) =>
        !actorId
          ? ids
          : (ids || []).filter(
              (id) =>
                id === actorId || compatible(batchOf(actorId), batchOf(id)),
            ),
    ),
    assertCanInteract: jest.fn(async () => {}),
  };
}

/** Ready-made Nest provider for the double above. */
export const studentYearPolicyMockProvider = (
  batchYears: Record<string, number | null> = {},
  currentYear = 2026,
) => ({
  provide: StudentYearPolicyService,
  useValue: createStudentYearPolicyMock(batchYears, currentYear),
});
