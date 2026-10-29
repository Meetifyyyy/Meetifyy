import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { groupApi } from '@shared/api/apiClient';
import { MESSAGE_KEYS } from '@shared/hooks/useMessages';
import { useAuth } from '@shared/context/AuthContext';
import { openVerificationModal } from '@shared/stores/verificationModalStore';
import { isMessagingEligibleStatus } from '@shared/utils/messagingEligibility';
import { useGuardedMutation } from '@shared/hooks/useGuardedMutation';
import { OfflineError } from '@shared/lib/offlineGuard';
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
 * Group-invite data layer, for the group preview (the sheet a chat's invite
 * card opens, an invite link, and a group's address opened by someone not in
 * it) and the join action behind its button.
 *
 * An invite is named by what it came through: `{ code }` for an invite link,
 * `{ messageId }` for a card in a chat, or nothing for the group's address.
 * The server decides from it what the preview may show and whether the
 * button may join (an expired invite shows the group but cannot), so the
 * invite is part of the preview's cache key.
 */

const inviteKey = (invite) => {
  if (invite?.code) return `c:${invite.code}`;
  if (invite?.messageId) return `m:${invite.messageId}`;
  return 'none';
};

export const INVITE_KEYS = {
  all: ['groupInvite'],
  preview: (groupId, invite) => ['groupInvite', String(groupId || ''), inviteKey(invite)],
  link: (code) => ['groupInvite', 'link', String(code || '')],
};

/**
 * Refetches every preview of the group with any of `ids` (whatever invite it
 * was opened through). After a join or a request, an answer to one, or a
 * failure that may mean the state moved on.
 */
export function refreshGroupPreviews(queryClient, ids) {
  const wanted = (Array.isArray(ids) ? ids : [ids]).filter(Boolean).map(String);
  if (!queryClient || wanted.length === 0) return;
  queryClient.invalidateQueries({
    queryKey: INVITE_KEYS.all,
    predicate: (query) => {
      const data = query.state.data;
      const own = [data?.id, data?.publicId, data?.internalId].filter(Boolean).map(String);
      return wanted.includes(String(query.queryKey[1])) || own.some((id) => wanted.includes(id));
    },
  });
}

/** Writes `patch` into every cached preview of the group with any of `ids`. */
function patchGroupPreviews(queryClient, ids, patch) {
  const wanted = ids.filter(Boolean).map(String);
  queryClient.setQueriesData({ queryKey: INVITE_KEYS.all }, (old) => {
    if (!old || typeof old !== 'object') return old;
    const own = [old.id, old.publicId, old.internalId].filter(Boolean).map(String);
    return own.some((id) => wanted.includes(id)) ? { ...old, ...patch } : old;
  });
}

/**
 * Maps a failed request to a stable code. The server sends these as the
 * response's `code` (or, for older refusals, its message); network failures
 * and unknown answers fall through to a generic code so the UI always has
 * something to switch on.
 */
export function inviteErrorCode(err) {
  if (err instanceof OfflineError) return 'NETWORK';
  const raw = String(err?.code || err?.message || '').toUpperCase();
  const known = [
    'GROUP_NOT_FOUND',
    'GROUP_CLOSED',
    'BLOCKED',
    'UNAUTHENTICATED',
    'INVITE_REQUIRED',
    'INVITE_EXPIRED',
    'INVITE_REVOKED',
    'INVITE_INVALID',
    'REQUEST_DECLINED',
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
      return 'This group is no longer available.';
    case 'GROUP_CLOSED':
      return 'This group has ended and is no longer accepting members.';
    case 'BLOCKED':
      return "You can't join this group.";
    case 'INVITE_REQUIRED':
    case 'INVITE_EXPIRED':
      return 'This invite link has expired. Ask a member for a new one.';
    case 'INVITE_REVOKED':
    case 'INVITE_INVALID':
      return 'This invite link is no longer valid.';
    case 'REQUEST_DECLINED':
      return 'An admin declined your request. You can ask again later.';
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
 * The group preview, readable whether or not the user is in the group. Opened
 * by a link code alone (`/g/<code>`), or by the group's id with the invite it
 * came through. `enabled: false` keeps the hook callable unconditionally.
 *
 * Refetched when the window regains focus or the connection returns, so a
 * request answered on another device, or while offline, shows its answer.
 */
export function useGroupPreview({ groupId, code, messageId } = {}, { enabled = true } = {}) {
  const invite = code ? { code } : messageId ? { messageId } : null;
  const byLink = Boolean(code) && !groupId;
  return useQuery({
    queryKey: byLink ? INVITE_KEYS.link(code) : INVITE_KEYS.preview(groupId, invite),
    queryFn: () => (byLink ? groupApi.getInviteLinkPreview(code) : groupApi.getInvitePreview(groupId, invite || {})),
    enabled: Boolean(groupId || code) && enabled,
    staleTime: 15 * 1000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    // A deleted group, an invalid link or a block is a settled answer:
    // retrying only delays the error state. Only transient failures retry.
    retry: (failureCount, err) => {
      const errCode = inviteErrorCode(err);
      if (errCode === 'NETWORK' || errCode === 'UNKNOWN') return failureCount < 2;
      return false;
    },
  });
}

/** Prefetches a preview (the invite card does this on pointer-down). */
export function prefetchGroupPreview(queryClient, { groupId, messageId }) {
  if (!queryClient || !groupId) return;
  const invite = messageId ? { messageId } : null;
  void queryClient.prefetchQuery({
    queryKey: INVITE_KEYS.preview(groupId, invite),
    queryFn: () => groupApi.getInvitePreview(groupId, invite || {}),
    staleTime: 15 * 1000,
  });
}

/**
 * Join (or ask to join) a group through an invite.
 *
 * The server is idempotent: a second tap cannot make a second membership or a
 * second request, and a request that already waits is answered as waiting.
 * `isPending` is surfaced so the button locks while the call is out. A call
 * that timed out after the server acted is safe to repeat for the same
 * reason; the preview is refetched after every failure so it shows the truth.
 */
export function useJoinGroup() {
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();
  const verificationStatus = currentUser?.verificationStatus;

  const mutation = useGuardedMutation(useMutation({
    mutationFn: ({ groupId, invite }) => groupApi.joinGroup(groupId, invite || {}),
    onSuccess: (result, { groupId }) => {
      const ids = [...new Set([groupId, result?.publicId, result?.internalId].filter(Boolean).map(String))];
      if (result?.status === 'PENDING') {
        // The button reads "Request pending" at once, not after a refetch.
        patchGroupPreviews(queryClient, ids, { joinState: 'REQUESTED', hasPendingRequest: true });
      }
      refreshGroupPreviews(queryClient, ids);
      if (result?.status === 'JOINED') {
        // In the list at once, so opening it does not wait for the refetch
        // below (and does not show the invite again while it does).
        const preview = queryClient
          .getQueriesData({ queryKey: INVITE_KEYS.all })
          .map(([, data]) => data)
          .find((data) => data && ids.includes(String(data.publicId)));
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
    onError: (_err, { groupId }) => refreshGroupPreviews(queryClient, [groupId]),
  }), 'action');

  const { mutateAsync } = mutation;
  /**
   * Joining a group chat is behind the live-selfie check (the server answers
   * 403 too). Unverified accounts get the verification prompt instead of the
   * request, and callers receive `{ status: JOIN_NEEDS_VERIFICATION }`. A 403
   * from a client whose status was stale opens the same prompt and rethrows.
   */
  const join = useCallback(
    async (groupId, preview, invite) => {
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
        return await mutateAsync({ groupId, invite });
      } catch (err) {
        if (isVerificationRequiredError(err)) openVerificationModal(JOIN_VERIFY_MESSAGE);
        throw err;
      }
    },
    [mutateAsync, currentUser, verificationStatus],
  );

  return { ...mutation, join };
}
