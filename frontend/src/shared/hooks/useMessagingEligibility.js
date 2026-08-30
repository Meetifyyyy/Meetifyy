import { useQuery } from '@tanstack/react-query';
import { dmApi } from '@shared/api/apiClient';
import { useAuth } from '@shared/context/AuthContext';
import {
  isMessagingEligibleStatus,
  MESSAGING_UNAVAILABLE_TEXT,
  MESSAGING_SELF_UNVERIFIED_TEXT,
} from '@shared/utils/messagingEligibility';

/**
 * Whether the viewer may send into this conversation right now.
 *
 * The rule is the backend's: a direct conversation needs BOTH people currently
 * VERIFIED; a group needs the sender. Everything this hook returns is derived
 * from live state — `currentUser.verificationStatus` (patched by the
 * `user:verification_changed` socket event) and the partner's status carried on
 * the conversation payload — so a status change flips the composer without a
 * reload and without a refetch.
 *
 * The draft case is the one that cannot read a conversation: opening Message on
 * a profile navigates to /messages/new before any conversation row exists. It
 * is answered by a small endpoint instead, which is also why the profile button
 * needs no gate of its own — the chat opens either way and explains itself here.
 */
export function useMessagingEligibility(conversation) {
  const { currentUser } = useAuth();

  const isGroup = Boolean(conversation?.isGroup || conversation?.type === 'GROUP');
  const isDraft = Boolean(conversation?.isDraft);
  const targetUserId =
    conversation?.targetUser?.id ||
    conversation?.targetUserId ||
    conversation?.userId ||
    null;

  // A status already on the conversation is preferred: it arrived with the
  // list and needs no request. The lookup below is the fallback for a draft
  // reached by URL, where nothing carried the recipient's status in.
  const knownTargetStatus =
    conversation?.targetUser?.verificationStatus ??
    conversation?.targetUser?.verification_status ??
    null;

  const needsLookup =
    !isGroup && !!targetUserId && !knownTargetStatus && conversation?.canSendMessages === undefined;

  const { data: lookup } = useQuery({
    queryKey: ['messaging-eligibility', targetUserId],
    queryFn: () => dmApi.getMessagingEligibility(targetUserId),
    enabled: needsLookup && Boolean(currentUser?.id),
    staleTime: 30 * 1000,
    retry: false,
  });

  const selfEligible = isMessagingEligibleStatus(currentUser?.verificationStatus);

  let targetEligible;
  if (isGroup) {
    targetEligible = true;
  } else if (knownTargetStatus) {
    targetEligible = isMessagingEligibleStatus(knownTargetStatus);
  } else if (lookup) {
    targetEligible = Boolean(lookup.targetEligible);
  } else if (conversation?.canSendMessages !== undefined) {
    // Server's own verdict for this pair, used when the partner's raw status
    // was not carried. It already folds in the viewer, but `selfEligible`
    // below is applied on top so a *local* status change still takes effect
    // before the list is refetched.
    targetEligible = Boolean(conversation.canSendMessages);
  } else {
    // Unknown so far. Stay permissive rather than flashing an unavailable
    // state over a conversation that is merely still loading; the backend is
    // the thing that actually refuses.
    targetEligible = true;
  }

  const canSend = selfEligible && targetEligible;

  return {
    canSend,
    selfEligible,
    targetEligible,
    // Whose problem it is decides the wording, and the viewer's own case takes
    // precedence — telling them the other person is unavailable when it is
    // their own account that is unverified would send them to the wrong fix.
    reason: canSend
      ? null
      : !selfEligible
        ? MESSAGING_SELF_UNVERIFIED_TEXT
        : MESSAGING_UNAVAILABLE_TEXT,
    isDraft,
  };
}
