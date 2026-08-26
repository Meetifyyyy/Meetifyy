import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { groupApi } from '@shared/api/apiClient';
import { MESSAGE_KEYS } from '@shared/hooks/useMessages';

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

  const mutation = useMutation({
    mutationFn: (groupId) => groupApi.joinGroup(groupId),
    onSuccess: (result, groupId) => {
      // Refresh the preview so the card flips to its joined/requested state
      // even if the user never leaves the screen.
      queryClient.invalidateQueries({ queryKey: INVITE_KEYS.preview(groupId) });
      if (result?.publicId && String(result.publicId) !== String(groupId)) {
        queryClient.invalidateQueries({ queryKey: INVITE_KEYS.preview(result.publicId) });
      }
      if (result?.status === 'JOINED') {
        queryClient.invalidateQueries({ queryKey: MESSAGE_KEYS.conversations });
        queryClient.invalidateQueries({ queryKey: ['groupDetails'] });
        // The history query was very likely rejected while the user was still
        // an outsider; clear it so the chat loads instead of showing not-found.
        queryClient.invalidateQueries({ queryKey: MESSAGE_KEYS.history(groupId) });
        if (result?.publicId) {
          queryClient.invalidateQueries({ queryKey: MESSAGE_KEYS.history(result.publicId) });
        }
      }
    },
  });

  const { mutateAsync } = mutation;
  const join = useCallback((groupId) => mutateAsync(groupId), [mutateAsync]);

  return { ...mutation, join };
}
