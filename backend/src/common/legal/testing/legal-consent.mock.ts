import { LegalConsentService } from '../legal-consent.service';

/**
 * Test double for the mandatory legal-acknowledgement gate.
 *
 * Defaults to "nothing requires acknowledgement", so the existing suites — which
 * are about search, uploads, messaging and sockets, not consent — keep testing
 * what they were written for. Pass `{ satisfied: false }` (or a list of pending
 * versions) to make the gate bite.
 *
 * `JwtGuard` takes this service as a constructor argument, so every test module
 * that instantiates a controller behind that guard needs the provider below.
 */
export function createLegalConsentMock(
  options: { satisfied?: boolean; pending?: any[]; published?: any[] } = {},
) {
  const pending = options.pending ?? [];
  const satisfied = options.satisfied ?? pending.length === 0;
  const published = options.published ?? pending;

  return {
    getPublishedVersions: jest.fn(async () => published),
    getPublishedVersion: jest.fn(
      async (type: string) =>
        published.find((v: any) => v.documentType === type) ?? null,
    ),
    getRequiredVersions: jest.fn(async () => pending),
    getPendingVersions: jest.fn(async () => (satisfied ? [] : pending)),
    isSatisfied: jest.fn(async () => satisfied),
    markSatisfied: jest.fn(),
    recordSignupConsent: jest.fn(async () => {}),
    invalidatePublished: jest.fn(),
    invalidateUser: jest.fn(),
  };
}

/** Ready-made Nest provider for the double above. */
export const legalConsentMockProvider = (
  options: { satisfied?: boolean; pending?: any[] } = {},
) => ({
  provide: LegalConsentService,
  useValue: createLegalConsentMock(options),
});
