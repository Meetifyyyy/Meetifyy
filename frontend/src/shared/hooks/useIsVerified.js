import { useAuth } from '@shared/context/AuthContext';
import { isMessagingEligibleStatus } from '@shared/utils/messagingEligibility';

/**
 * Whether the signed-in account is currently verified.
 *
 * One definition, rather than the `currentUser?.verificationStatus ===
 * 'VERIFIED'` comparison that had been copied into a dozen components. It is
 * read from the auth user, which the `user:verification_changed` socket event
 * keeps current, so it needs no request of its own — a component asking this
 * question costs nothing.
 *
 * This is presentation state. It decides what to render and what to fetch; the
 * backend independently refuses every gated action.
 */
export function useIsVerified() {
  const { currentUser } = useAuth();
  return isMessagingEligibleStatus(currentUser?.verificationStatus);
}
