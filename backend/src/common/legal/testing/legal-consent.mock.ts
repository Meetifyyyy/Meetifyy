import {
  LegalConsentService,
  type PublishedLegalVersion,
} from '../legal-consent.service';
import type { Stub } from '../../testing/stub';

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
  options: {
    satisfied?: boolean;
    pending?: PublishedLegalVersion[];
    published?: PublishedLegalVersion[];
  } = {},
) {
  const pending = options.pending ?? [];
  const satisfied = options.satisfied ?? pending.length === 0;
  const published = options.published ?? pending;

  const mock = {
    getPublishedVersions: jest.fn(() => Promise.resolve(published)),
    getPublishedVersion: jest.fn((type: string) =>
      Promise.resolve(published.find((v) => v.documentType === type) ?? null),
    ),
    getRequiredVersions: jest.fn(() => Promise.resolve(pending)),
    getPendingVersions: jest.fn(() =>
      Promise.resolve(satisfied ? [] : pending),
    ),
    isSatisfied: jest.fn(() => Promise.resolve(satisfied)),
    markSatisfied: jest.fn(),
    recordSignupConsent: jest.fn(() => Promise.resolve()),
    invalidatePublished: jest.fn(),
    invalidateUser: jest.fn(),
  } satisfies Stub<LegalConsentService>;
  return mock as typeof mock & LegalConsentService;
}

/** Ready-made Nest provider for the double above. */
export const legalConsentMockProvider = (
  options: { satisfied?: boolean; pending?: PublishedLegalVersion[] } = {},
) => ({
  provide: LegalConsentService,
  useValue: createLegalConsentMock(options),
});
