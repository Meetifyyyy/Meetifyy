import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { groupApi } from '@shared/api/apiClient';
import { MESSAGE_KEYS } from '@shared/hooks/useMessages';
import { useAuth } from '@shared/context/AuthContext';
import { openVerificationModal } from '@shared/stores/verificationModalStore';
import { isMessagingEligibleStatus } from '@shared/utils/messagingEligibility';
import { useGuardedMutation } from '@shared/hooks/useGuardedMutation';
import { seedJoinedGroup } from '@features/messages/shared/utils/groupMembership';

/** What `join` resolves with when the live-selfie check stopped it client side. */
export const JOIN_NEEDS_VERIFICATION = 'VERIFICATION_REQUIRED';
const JOIN_VERIFY_MESSAGE = 'Verify with a live selfie to join group chats.';

/**
 * The server's selfie guard answers 403 with this sentence (no code). Matched
 * so a stale client-side status still ends in the verification prompt.
 */
export function isVerificationRequiredError(err) {
  if (err?.status !== 403) return false;
  const raw = String(err?.code || err?.message || '');
  return /verification.*required|VERIFICATION_REQUIRED/i.test(raw);
}

/**
 * Group-invite data layer.
 *
 * The invite card and the invite-link landing panel both need the same three
 * things — what the group is, whether this user may join it, and a join action
 * that is safe to press twice. Keeping them here means neither screen depends
 * on props being threaded down through the message list.
 */

export const INVITE_KEYS = {
  preview: (groupId) => ['groupInvite', String(groupId || '')],
};

/**
 * Maps a failed request to a stable code. The server sends these as the
 * exception message; older deployments and network failures fall through to
 * a generic code so the UI always has something to switch on.
 */
export function inviteErrorCode(err) {
  const raw = String(err?.code || err?.message || '').toUpperCase();
  const known = [
    'GROUP_NOT_FOUND',
    'GROUP_CLOSED',
    'BLOCKED',
    'UNAUTHENTICATED',
  ];
  if (known.includes(raw)) return raw;
  if (isVerificationRequiredError(err)) return 'VERIFICATION_REQUIRED';
  if (err?.status === 404) return 'GROUP_NOT_FOUND';
  if (err?.status === 403) return 'FORBIDDEN';
  if (err?.status === 401) return 'UNAUTHENTICATED';
  // No status at all means the request never reached the server.
  if (err && err.status === undefined) return 'NETWORK';
  return 'UNKNOWN';
}

export function inviteErrorMessage(err) {
  switch (inviteErrorCode(err)) {
    case 'GROUP_NOT_FOUND':
      return 'This group no longer exists.';
    case 'GROUP_CLOSED':
      return 'This group has ended and is no longer accepting members.';
    case 'BLOCKED':
      return "You can't join this group.";
    case 'VERIFICATION_REQUIRED':
      return JOIN_VERIFY_MESSAGE;
    case 'FORBIDDEN':
      return "You don't have permission to join this group.";
    case 'UNAUTHENTICATED':
      return 'Please sign in to join this group.';
    case 'NETWORK':
      return 'Connection problem. Check your network and try again.';
    default:
      return "Couldn't join the group. Please try again.";
  }
}

/**
 * Invite preview for any group, readable whether or not the user is a member.
 * `enabled: false` for a missing id keeps the hook callable unconditionally.
 */
export function useGroupInvitePreview(groupId, { enabled = true } = {}) {
  return useQuery({
    queryKey: INVITE_KEYS.preview(groupId),
    queryFn: () => groupApi.getInvitePreview(groupId),
    enabled: Boolean(groupId) && enabled,
    staleTime: 15 * 1000,
    // A deleted group or a block is a settled answer — retrying just delays
    // the error state. Only transient failures are worth a second attempt.
    retry: (failureCount, err) => {
      const code = inviteErrorCode(err);
      if (code === 'NETWORK' || code === 'UNKNOWN') return failureCount < 2;
      return false;
    },
  });
}

/**
 * Join (or request to join) a group.
 *
 * The request itself is idempotent server-side, so a double-tap cannot create
 * a second membership; `isPending` is still surfaced so the button can lock.
 * On a successful join the conversation list is refetched immediately, which
 * is what makes the group appear in the sidebar before the socket event lands.
 */
export function useJoinGroup() {
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();
  const verificationStatus = currentUser?.verificationStatus;

  const mutation = useGuardedMutation(useMutation({
    mutationFn: (groupId) => groupApi.joinGroup(groupId),
    onSuccess: (result, groupId) => {
      // Refresh the preview so the card flips to its joined/requested state
      // even if the user never leaves the screen.
      queryClient.invalidateQueries({ queryKey: INVITE_KEYS.preview(groupId) });
      if (result?.publicId && String(result.publicId) !== String(groupId)) {
        queryClient.invalidateQueries({ queryKey: INVITE_KEYS.preview(result.publicId) });
      }
      if (result?.status === 'JOINED') {
        const ids = [...new Set([groupId, result.publicId, result.internalId].filter(Boolean).map(String))];
        // In the list at once, so opening it does not wait for the refetch
        // below (and does not show the invite again while it does).
        const preview = ids
          .map((id) => queryClient.getQueryData(INVITE_KEYS.preview(id)))
          .find(Boolean);
        seedJoinedGroup(queryClient, result, preview);
        queryClient.invalidateQueries({ queryKey: MESSAGE_KEYS.conversations });
        ids.forEach((id) => {
          // Only this group's details: the rest are unchanged.
          queryClient.invalidateQueries({ queryKey: ['groupDetails', id], exact: true });
          // The history query was very likely rejected while the user was
          // still an outsider. Reset rather than invalidated: an invalidated
          // query keeps its error while it refetches, and the chat screen
          // reads that error as "not a conversation you can open".
          queryClient.resetQueries({ queryKey: MESSAGE_KEYS.history(id), exact: true });
        });
      }
    },
  }), 'action');

  const { mutateAsync } = mutation;
  /**
   * Joining a group chat is behind the live-selfie check (the server answers
   * 403 too). Unverified accounts get the verification prompt instead of the
   * request, and callers receive `{ status: JOIN_NEEDS_VERIFICATION }`. A 403
   * from a client whose status was stale opens the same prompt and rethrows.
   */
  const join = useCallback(
    async (groupId, preview) => {
      // The account's own status decides; the preview's optional flag only
      // stands in when there is no signed-in user object to read.
      const blocked = currentUser
        ? !isMessagingEligibleStatus(verificationStatus)
        : preview?.requiresVerification === true;
      if (blocked) {
        openVerificationModal(JOIN_VERIFY_MESSAGE);
        return { status: JOIN_NEEDS_VERIFICATION };
      }
      try {
        return await mutateAsync(groupId);
      } catch (err) {
        if (isVerificationRequiredError(err)) openVerificationModal(JOIN_VERIFY_MESSAGE);
        throw err;
      }
    },
    [mutateAsync, currentUser, verificationStatus],
  );

  return { ...mutation, join };
}
