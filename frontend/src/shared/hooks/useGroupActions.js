import { useQueryClient } from '@tanstack/react-query';
import { messagesApi, groupApi } from '../api/apiClient';
import { useAuth } from '../context/AuthContext';
import { showToast } from '../utils/toast';
import { applyGroupRoleChange, matchesConversationId, removeGroupJoinRequest } from '../../features/messages/shared/utils/cacheUtils';
import { scheduleConversationWrite } from '../utils/conversationWriteQueue';

/**
 * The group-chat / conversation admin actions.
 *
 * Group ids here are always the server's (public or internal). The `c_`
 * branches that routed some of these calls to the communities API are gone:
 * nothing has produced a `c_` conversation id since community group chats
 * were removed, and had one arrived, its settings would have been written to
 * a community.
 */
export const JOIN_REQUEST_INELIGIBLE = 'JOIN_REQUEST_INELIGIBLE';
export const JOIN_REQUEST_INELIGIBLE_MESSAGE =
  'This person needs to verify with a live selfie before they can join.';

export function useGroupActions() {
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();

  /** Writes fields onto a group's list row and its details, optimistically. */
  const patchGroup = (convId, fields) => {
    queryClient.setQueryData(['conversations'], (old) =>
      Array.isArray(old) ? old.map((c) => (matchesConversationId(c, convId) ? { ...c, ...fields } : c)) : old,
    );
    queryClient.setQueriesData({ queryKey: ['groupDetails'] }, (old) =>
      old && matchesConversationId(old, convId) ? { ...old, ...fields } : old,
    );
  };

  /** The current values of some of a group's fields, to put back on failure. */
  const readGroupFields = (convId, keys) => {
    const details = queryClient
      .getQueriesData({ queryKey: ['groupDetails'] })
      .map(([, data]) => data)
      .find((data) => data && matchesConversationId(data, convId));
    const list = queryClient.getQueryData(['conversations']);
    const row = Array.isArray(list) ? list.find((c) => matchesConversationId(c, convId)) : null;
    return Object.fromEntries(keys.map((k) => [k, details?.[k] ?? row?.[k]]));
  };

  /**
   * A settings write: shown at once, and put back if the server refuses it.
   * The page used to keep showing a value the server never saved (a failed
   * call was an unhandled rejection), until the next refetch flipped it back.
   *
   * @returns {Promise<boolean>} whether the server saved it
   */
  const saveGroupFields = async (convId, fields, call) => {
    const previous = readGroupFields(convId, Object.keys(fields));
    patchGroup(convId, fields);
    try {
      await call();
      return true;
    } catch {
      patchGroup(convId, previous);
      showToast("Couldn't save that setting", 'error');
      return false;
    }
  };
  // Neither the processed conversation list nor updateMessagesCache is used in
  // here -- every reference below is to the ['conversations'] query key, not to
  // the array -- so this hook deliberately does not subscribe to either.

  /**
   * Pin/unpin a conversation for the current user.
   *
   * `pinnedAt` is written alongside the flag so the list can re-sort locally
   * the moment the tap lands — pinned first, most recently pinned at the top —
   * matching the order the server will return on the next fetch. Sorting on
   * the flag alone left a freshly pinned chat wherever its last-activity time
   * put it among the other pins, which reads as the pin not having applied.
   */
  const togglePinConversation = async (convId, currentPinned) => {
    let isPinnedNow = currentPinned;
    if (typeof isPinnedNow !== 'boolean') {
      const cached = queryClient.getQueryData(['conversations']);
      if (Array.isArray(cached)) {
        const found = cached.find(c => c.id === convId || c.publicId === convId);
        if (found) isPinnedNow = !!(found.isPinned || found.pinned);
      }
    }
    isPinnedNow = Boolean(isPinnedNow);
    const nextPinned = !isPinnedNow;
    const previousPinnedAt = (() => {
      const cached = queryClient.getQueryData(['conversations']);
      const found = Array.isArray(cached) ? cached.find(c => c.id === convId || c.publicId === convId) : null;
      return found?.pinnedAt ?? null;
    })();

    const writePinned = (pinned, pinnedAt) => {
      queryClient.setQueryData(['conversations'], (old) => {
        if (!Array.isArray(old)) return old;
        return old.map(c => (c.id === convId || c.publicId === convId)
          ? { ...c, isPinned: pinned, pinned, pinnedAt }
          : c);
      });
    };

    writePinned(nextPinned, nextPinned ? new Date().toISOString() : null);

    scheduleConversationWrite(`pin:${convId}`, async () => {
      const latest = queryClient.getQueryData(['conversations']);
      const row = Array.isArray(latest) ? latest.find(c => c.id === convId || c.publicId === convId) : null;
      const desired = row ? Boolean(row.pinned ?? row.isPinned) : nextPinned;
      try {
        await messagesApi.pinConversation(convId, desired);
      } catch (e) {
        writePinned(isPinnedNow, previousPinnedAt);
        showToast(desired ? "Couldn't pin chat" : "Couldn't unpin chat", 'error');
      }
    });
  };

  const updateGroupInfo = async (convId, name, avatarKey, description, rollbackAvatarKey = undefined) => {
    const isBlob = typeof avatarKey === 'string' && avatarKey.startsWith('blob:');
    const updateObj = {
      ...(name !== undefined ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(avatarKey !== undefined ? { avatar: avatarKey, avatarKey } : {})
    };

    let previousState = rollbackAvatarKey !== undefined 
      ? { avatar: rollbackAvatarKey, avatarKey: rollbackAvatarKey }
      : null;

    queryClient.setQueryData(['conversations'], (old) => {
      if (!Array.isArray(old)) return old;
      return old.map(c => {
        if (String(c.id) === String(convId) || String(c.publicId) === String(convId) || String(c.internalId) === String(convId)) {
          if (!previousState) previousState = { avatar: c.avatarKey || c.avatar, avatarKey: c.avatarKey || c.avatar };
          return { ...c, ...updateObj };
        }
        return c;
      });
    });

    queryClient.setQueriesData({ queryKey: ['groupDetails'] }, (old) => {
      if (!old) return old;
      const match = String(old.id) === String(convId) || String(old.publicId) === String(convId) || String(old.internalId) === String(convId);
      if (match) {
        if (!previousState) previousState = { avatar: old.avatarKey || old.avatar, avatarKey: old.avatarKey || old.avatar };
        return { ...old, ...updateObj };
      }
      return old;
    });

    const apiPayload = {
      ...(name !== undefined ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(!isBlob && avatarKey !== undefined ? { avatarKey } : {})
    };

    if (Object.keys(apiPayload).length === 0) return;

    try {
      return await groupApi.updateGroupInfo(convId, apiPayload);
    } catch (err) {
      if (avatarKey !== undefined && previousState) {
        queryClient.setQueryData(['conversations'], (old) => {
          if (!Array.isArray(old)) return old;
          return old.map(c => {
            if (String(c.id) === String(convId) || String(c.publicId) === String(convId) || String(c.internalId) === String(convId)) {
              return { ...c, avatar: previousState.avatar, avatarKey: previousState.avatarKey };
            }
            return c;
          });
        });
        queryClient.setQueriesData({ queryKey: ['groupDetails'] }, (old) => {
          if (!old) return old;
          const match = String(old.id) === String(convId) || String(old.publicId) === String(convId) || String(old.internalId) === String(convId);
          if (match) {
            return { ...old, avatar: previousState.avatar, avatarKey: previousState.avatarKey };
          }
          return old;
        });
      }
      throw err;
    }
  };

  const removeGroupMember = async (convId, memberId) => {
    queryClient.setQueryData(['conversations'], (old) => {
      if (!Array.isArray(old)) return old;
      return old.map(c => {
        if (c.id === convId || c.publicId === convId || c.internalId === convId) {
          const currentMembers = c.members || [];
          const currentAdmins = c.admins || [];
          return {
            ...c,
            members: currentMembers.filter(m => (m.userId || m.id || m) !== memberId),
            admins: currentAdmins.filter(id => id !== memberId),
            memberCount: Math.max(0, (c.memberCount || 1) - 1)
          };
        }
        return c;
      });
    });
    await groupApi.removeMember(convId, memberId);
    queryClient.invalidateQueries({ queryKey: ['conversations'] });
    queryClient.invalidateQueries({ queryKey: ['group-chats'] });
    queryClient.invalidateQueries({ queryKey: ['groupDetails'] });
    queryClient.invalidateQueries({ queryKey: ['groupDetails', convId] });
  };

  const addGroupMember = async (convId, targetUserId) => {
    await groupApi.addMember(convId, targetUserId);
    queryClient.invalidateQueries({ queryKey: ['conversations'] });
  };

  const leaveGroup = async (convId) => {
    await groupApi.leaveGroup(convId);
    queryClient.invalidateQueries({ queryKey: ['conversations'] });
  };
  /** Admin settings (who can join). @returns {Promise<boolean>} */
  const updateGroupSettings = (convId, data) =>
    saveGroupFields(convId, data, () => groupApi.updateSettings(convId, data));

  /** Who can edit the group's name, photo and description. @returns {Promise<boolean>} */
  const updateGroupEditPermission = (convId, permission) =>
    saveGroupFields(convId, { editGroupPermission: permission }, () =>
      groupApi.updatePermissions(convId, permission));

  const changeGroupOwner = async (convId, targetUserId) => {
    queryClient.setQueryData(['conversations'], (old) => {
      if (!Array.isArray(old)) return old;
      return old.map(c => {
        const isMatch = c.id === convId || c.publicId === convId || c.internalId === convId || String(c.id) === String(convId);
        if (isMatch) {
          const currentAdmins = c.admins || [];
          const updatedAdmins = Array.from(new Set([...currentAdmins, currentUser?.id].filter(Boolean)));
          const updatedMembers = (c.members || c.participants || []).map(p => {
            const pId = typeof p === 'string' ? p : (p.id || p.userId || p.user?.id);
            if (String(pId) === String(targetUserId)) {
              return typeof p === 'object' ? { ...p, role: 'OWNER' } : p;
            }
            if (String(pId) === String(currentUser?.id)) {
              return typeof p === 'object' ? { ...p, role: 'ADMIN' } : p;
            }
            return p;
          });

          return {
            ...c,
            ownerId: targetUserId,
            admins: updatedAdmins,
            members: updatedMembers,
            participants: updatedMembers
          };
        }
        return c;
      });
    });

    applyGroupRoleChange(queryClient, convId, targetUserId, 'OWNER');
    try {
      await groupApi.changeOwner(convId, targetUserId);
    } finally {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      queryClient.invalidateQueries({ queryKey: ['groupDetails'] });
    }
  };

  // `/api/group-chats/*` rather than the `/api/messages/*` mirror of the same
  // operations. Both hit the same service, but only the group-chats controller
  // emits `group:role_changed` to the other members and bumps the server-side
  // group-details cache version — so promoting through the messages mirror
  // updated nobody else and left the server serving a stale details payload.
  const changeRole = async (convId, targetUserId, newRole, call) => {
    // Optimistic, through the same patch the socket event uses, so the actor
    // sees the new role immediately — in the list AND in Group Details.
    applyGroupRoleChange(queryClient, convId, targetUserId, newRole);
    try {
      await call();
    } finally {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      queryClient.invalidateQueries({ queryKey: ['groupDetails'] });
    }
  };

  const promoteToAdmin = (convId, targetUserId) =>
    changeRole(convId, targetUserId, 'ADMIN', () => groupApi.promoteAdmin(convId, targetUserId));

  const demoteFromAdmin = (convId, targetUserId) =>
    changeRole(convId, targetUserId, 'MEMBER', () => groupApi.demoteAdmin(convId, targetUserId));

  const endGroup = async (convId) => {
    await groupApi.endGroup(convId);
    queryClient.invalidateQueries({ queryKey: ['conversations'] });
    queryClient.invalidateQueries({ queryKey: ['groupDetails'] });
  };

  /**
   * An approval another admin already made answers `changed: false`, and one
   * they already declined answers 409: either way the row goes, and the admin
   * is told, rather than shown a failure for something that was settled.
   */
  const acceptGroupJoinRequest = async (convId, targetUserId) => {
    try {
      const result = await groupApi.acceptJoinRequest(convId, targetUserId);
      if (result && result.changed === false) {
        removeGroupJoinRequest(queryClient, convId, targetUserId);
        showToast('Another admin already approved this request', 'info');
      }
    } catch (err) {
      if (err?.status === 409 && err?.code === 'REQUEST_ALREADY_DECLINED') {
        removeGroupJoinRequest(queryClient, convId, targetUserId);
        showToast('Another admin already declined this request', 'info');
        queryClient.invalidateQueries({ queryKey: ['groupDetails'] });
        queryClient.invalidateQueries({ queryKey: ['groupJoinActivity'] });
        return false;
      }
      // The requester cannot join (not selfie-verified, or no longer
      // reachable). The server has removed the request already; take it off
      // the list too, and say why in words an admin can act on.
      if (err?.status === 403 && err?.code === JOIN_REQUEST_INELIGIBLE) {
        removeGroupJoinRequest(queryClient, convId, targetUserId);
        showToast(JOIN_REQUEST_INELIGIBLE_MESSAGE, 'error');
        queryClient.invalidateQueries({ queryKey: ['conversations'] });
        queryClient.invalidateQueries({ queryKey: ['groupDetails'] });
        return false;
      }
      showToast("Couldn't accept the request", 'error');
      return false;
    }
    queryClient.invalidateQueries({ queryKey: ['conversations'] });
    queryClient.invalidateQueries({ queryKey: ['groupDetails'] });
    queryClient.invalidateQueries({ queryKey: ['groupJoinActivity'] });
    return true;
  };

  /**
   * The row goes at once; if the server refuses, the list is refetched (it
   * puts the request back) and the admin is told. A failure used to be an
   * unhandled rejection with no word to the admin.
   *
   * @returns {Promise<boolean>}
   */
  const declineGroupJoinRequest = async (convId, targetUserId) => {
    removeGroupJoinRequest(queryClient, convId, targetUserId);
    try {
      const result = await groupApi.declineJoinRequest(convId, targetUserId);
      if (result && result.changed === false) {
        showToast('Another admin already answered this request', 'info');
      }
      return true;
    } catch {
      showToast("Couldn't decline the request", 'error');
      return false;
    } finally {
      queryClient.invalidateQueries({ queryKey: ['groupDetails'] });
      queryClient.invalidateQueries({ queryKey: ['groupJoinActivity'] });
    }
  };

  /**
   * Revokes every invite link the group has (owner and admins; the server
   * checks). The sheet's cached link is one of them, so it is dropped and the
   * next opening asks for a new one.
   *
   * @returns {Promise<boolean>}
   */
  const resetInviteLinks = async (convId) => {
    try {
      await groupApi.resetInviteLinks(convId);
      queryClient.removeQueries({ queryKey: ['groupInviteLink'] });
      return true;
    } catch {
      showToast("Couldn't reset the invite links", 'error');
      return false;
    }
  };

  return {
    togglePinConversation,
    updateGroupInfo,
    removeGroupMember,
    addGroupMember,
    leaveGroup,
    updateGroupSettings,
    updateGroupEditPermission,
    changeGroupOwner,
    promoteToAdmin,
    demoteFromAdmin,
    endGroup,
    acceptGroupJoinRequest,
    declineGroupJoinRequest,
    resetInviteLinks,
  };
}
