import { VerificationStatus } from '@prisma/client';
import { VerificationAccessService } from '../verification-access.service';
import type { Stub } from '../../testing/stub';

/**
 * Test double for the messaging verification policy.
 *
 * Defaults to "everyone is eligible" so existing suites — which are about
 * blocks, deletion, invites and routing, not verification — keep exercising
 * the behaviour they were written for. Pass `ineligibleUserIds` to test the
 * refusal path.
 */
export function createVerificationAccessMock(ineligibleUserIds: string[] = []) {
  const ineligible = new Set(ineligibleUserIds);
  const isEligible = (id: string) => !ineligible.has(id);

  const mock = {
    isEnforcementEnabled: jest.fn(() => true),
    isEligibleStatus: jest.fn(
      (status: VerificationStatus | null | undefined) =>
        status === VerificationStatus.VERIFIED,
    ),
    isUserEligible: jest.fn((userId: string) =>
      Promise.resolve(isEligible(userId)),
    ),
    getEligibilityMap: jest.fn((userIds: string[]) => {
      const map = new Map<string, boolean>();
      (userIds || [])
        .filter(Boolean)
        .forEach((id) => map.set(id, isEligible(id)));
      return Promise.resolve(map);
    }),
    getIneligibleUserIds: jest.fn((userIds: string[]) =>
      Promise.resolve((userIds || []).filter((id) => id && !isEligible(id))),
    ),
    // The query-layer form of the same rule, for suites that assert on an
    // emitted `where` rather than on a thrown refusal.
    eligibleUserWhere: jest.fn(() => ({
      verificationStatus: VerificationStatus.VERIFIED,
    })),
    assertUsersEligible: jest.fn(() => Promise.resolve()),
    assertCanMessageInConversation: jest.fn(() => Promise.resolve()),
    announceStatusChange: jest.fn(() => Promise.resolve()),
  } satisfies Stub<VerificationAccessService>;
  return mock as typeof mock & VerificationAccessService;
}

/** Ready-made Nest provider for the double above. */
export const verificationAccessMockProvider = (
  ineligibleUserIds: string[] = [],
) => ({
  provide: VerificationAccessService,
  useValue: createVerificationAccessMock(ineligibleUserIds),
});
