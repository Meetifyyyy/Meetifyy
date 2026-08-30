import { VerificationStatus } from '@prisma/client';
import { VerificationAccessService } from '../verification-access.service';

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

  return {
    isEnforcementEnabled: jest.fn(() => true),
    isEligibleStatus: jest.fn(
      (status: VerificationStatus | null | undefined) =>
        status === VerificationStatus.VERIFIED,
    ),
    isUserEligible: jest.fn(async (userId: string) => isEligible(userId)),
    getEligibilityMap: jest.fn(async (userIds: string[]) => {
      const map = new Map<string, boolean>();
      (userIds || [])
        .filter(Boolean)
        .forEach((id) => map.set(id, isEligible(id)));
      return map;
    }),
    getIneligibleUserIds: jest.fn(async (userIds: string[]) =>
      (userIds || []).filter((id) => id && !isEligible(id)),
    ),
    assertUsersEligible: jest.fn(async () => {}),
    assertCanMessageInConversation: jest.fn(async () => {}),
    announceStatusChange: jest.fn(async () => {}),
  };
}

/** Ready-made Nest provider for the double above. */
export const verificationAccessMockProvider = (
  ineligibleUserIds: string[] = [],
) => ({
  provide: VerificationAccessService,
  useValue: createVerificationAccessMock(ineligibleUserIds),
});
