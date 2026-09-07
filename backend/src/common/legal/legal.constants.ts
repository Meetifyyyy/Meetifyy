import { LegalDocumentType } from '@prisma/client';

/**
 * Shape the client keys its mandatory legal-acknowledgement flow off.
 *
 * Sits alongside `ACCOUNT_SUSPENDED` and `ACCOUNT_PENDING_DELETION` in
 * `jwt.guard.ts`: all three are lifecycle states in which the session is
 * deliberately still valid but the account may only reach the routes that
 * resolve the state.
 */
export const LEGAL_ACKNOWLEDGEMENT_REQUIRED_CODE =
  'LEGAL_ACKNOWLEDGEMENT_REQUIRED';

/**
 * The public URL each document is served at.
 *
 * One table rather than a convention, because these paths are already linked
 * from outside the app (emails, the landing footer, external references) and
 * are not derivable from the enum member name — `/terms-and-conditions` is not
 * `/terms-of-service`. The consent modal builds its "read the full document"
 * links from here, so a mismatch would send a user to a 404 in the one flow
 * they cannot leave.
 */
export const LEGAL_DOCUMENT_PATHS: Record<LegalDocumentType, string> = {
  TERMS_OF_SERVICE: '/terms-and-conditions',
  PRIVACY_POLICY: '/privacy-policy',
  COOKIE_POLICY: '/cookie-policy',
  COMMUNITY_GUIDELINES: '/community-guidelines',
};

/** Human labels, used in the portal, the consent modal and audit entries. */
export const LEGAL_DOCUMENT_LABELS: Record<LegalDocumentType, string> = {
  TERMS_OF_SERVICE: 'Terms of Service',
  PRIVACY_POLICY: 'Privacy Policy',
  COOKIE_POLICY: 'Cookie Policy',
  COMMUNITY_GUIDELINES: 'Community Guidelines',
};

/** Every document the platform publishes, in the order they are presented. */
export const LEGAL_DOCUMENT_TYPES: LegalDocumentType[] = [
  LegalDocumentType.TERMS_OF_SERVICE,
  LegalDocumentType.PRIVACY_POLICY,
  LegalDocumentType.COOKIE_POLICY,
  LegalDocumentType.COMMUNITY_GUIDELINES,
];
