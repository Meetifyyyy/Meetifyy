import type { Prisma } from '@prisma/client';
import {
  StudentYearPolicyService,
  type StudentYearSubject,
} from '../student-year-policy.service';
import type { Stub } from '../../testing/stub';

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

  const mock = {
    isEnforcementEnabled: jest.fn(() => true),
    getCurrentAcademicYear: jest.fn(() => currentYear),
    getUserBatchYear: jest.fn(
      (user: StudentYearSubject | null | undefined) =>
        user?.batchYear ?? batchOf(String(user?.id)) ?? null,
    ),
    deriveBatchYearForStorage: jest.fn(() => null),
    isFirstYearBatch: jest.fn((batch: number | null | undefined) =>
      isFirstYear(batch ?? null),
    ),
    isFirstYearStudent: jest.fn((user: StudentYearSubject | null | undefined) =>
      isFirstYear(user?.batchYear ?? batchOf(String(user?.id)) ?? null),
    ),
    areBatchYearsCompatible: jest.fn((a: number | null, b: number | null) =>
      compatible(a, b),
    ),
    canUsersInteract: jest.fn(
      (
        a: StudentYearSubject | null | undefined,
        b: StudentYearSubject | null | undefined,
      ) =>
        compatible(
          a?.batchYear ?? batchOf(String(a?.id)) ?? null,
          b?.batchYear ?? batchOf(String(b?.id)) ?? null,
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
    // The exact complement, for the `participants: { none: ... }` filters.
    // Real shape, not `{}`, so a suite asserting on the emitted `where` can
    // tell the isolation clause apart from the rest of the query.
    incompatibleUserWhere: jest.fn((viewerBatch: number | null | undefined) =>
      isFirstYear(viewerBatch ?? null)
        ? { OR: [{ batchYear: { not: currentYear } }, { batchYear: null }] }
        : { batchYear: currentYear },
    ),
    // Returns the caller's `where` untouched, so a suite that is not about
    // batch years sees exactly the query it was written against.
    injectUserFilter: jest.fn((where: Prisma.UserWhereInput) => where),
    visibleRelationWhere: jest.fn(() => ({})),
    visibleUserSqlPredicate: jest.fn(() => 'TRUE'),
    invalidate: jest.fn(),
    invalidateAll: jest.fn(),
    getBatchYearMap: jest.fn((ids: string[]) => {
      const map = new Map<string, number | null>();
      (ids || []).filter(Boolean).forEach((id) => map.set(id, batchOf(id)));
      return Promise.resolve(map);
    }),
    resolveContext: jest.fn((id: string) =>
      Promise.resolve(
        id
          ? {
              id,
              batchYear: batchOf(id),
              isFirstYear: isFirstYear(batchOf(id)),
            }
          : null,
      ),
    ),
    getBatchYearFor: jest.fn((id: string) => Promise.resolve(batchOf(id))),
    canIdsInteract: jest.fn((a: string, b: string) =>
      Promise.resolve(compatible(batchOf(a), batchOf(b))),
    ),
    getIncompatibleUserIds: jest.fn((actorId: string, ids: string[]) =>
      Promise.resolve(
        (ids || []).filter(
          (id) => id !== actorId && !compatible(batchOf(actorId), batchOf(id)),
        ),
      ),
    ),
    filterInteractableUserIds: jest.fn((actorId: string, ids: string[]) =>
      Promise.resolve(
        !actorId
          ? ids
          : (ids || []).filter(
              (id) =>
                id === actorId || compatible(batchOf(actorId), batchOf(id)),
            ),
      ),
    ),
    assertCanInteract: jest.fn(() => Promise.resolve()),
  } satisfies Stub<StudentYearPolicyService>;
  // Usable wherever the real service is expected, with its members still
  // typed as the jest mocks above.
  return mock as typeof mock & StudentYearPolicyService;
}

/** Ready-made Nest provider for the double above. */
export const studentYearPolicyMockProvider = (
  batchYears: Record<string, number | null> = {},
  currentYear = 2026,
) => ({
  provide: StudentYearPolicyService,
  useValue: createStudentYearPolicyMock(batchYears, currentYear),
});
