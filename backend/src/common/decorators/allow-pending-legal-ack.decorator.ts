import { SetMetadata } from '@nestjs/common';

export const ALLOW_PENDING_LEGAL_ACK_KEY = 'allowPendingLegalAck';

/**
 * Marks a route reachable by an account that has not yet accepted a legal
 * version whose acceptance is mandatory.
 *
 * The session stays valid on purpose — the user has to be able to read the new
 * document and accept it — so `JwtGuard` refuses every authenticated route that
 * does NOT carry this, exactly as it does for a suspended or deleting account.
 * The modal the client renders is the explanation; this is the enforcement.
 *
 * Only the handful of routes that serve the acknowledgement flow itself carry
 * it: reading the pending list, reading a document, recording an acceptance,
 * the profile sync that tells the client which screen to show, and signing out.
 * Every addition widens what an unconsented account can do, so it should be a
 * deliberate decision each time.
 */
export const AllowPendingLegalAck = () =>
  SetMetadata(ALLOW_PENDING_LEGAL_ACK_KEY, true);
