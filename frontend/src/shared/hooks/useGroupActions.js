import { useQueryClient } from '@tanstack/react-query';
import { messagesApi, groupApi, communitiesApi } from '../api/apiClient';
import { useAuth } from '../context/AuthContext';
import { useConversations } from './useMessages';
import { useMessageActions } from './useMessageActions';
import { showToast } from '../utils/toast';

/**
 * The group-chat / conversation admin actions `useData` used to define inline.
 *
 * Extracted verbatim -- same optimistic cache writes, same rollbacks, same
 * toasts and invalidations. `useData` consumes this hook so there is exactly
 * one implementation while both exist.
 */
export function useGroupActions() {
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();
  const { conversations } = useConversations();
  const { updateMessagesCache } = useMessageActions();

  const togglePinConversation = async (convId, currentPinned) => {
    let isPinnedNow = currentPinned;
    if (typeof isPinnedNow !== 'boolean') {
      const cached = queryClient.getQueryData(['conversations']);
      if (Array.isArray(cached)) {
        const found = cached.find(c => c.id === convId || c.publicId === convId);
        if (found) isPinnedNow = !!(found.isPinned || found.pinned);
      }
    }
    const nextPinned = !isPinnedNow;
    queryClient.setQueryData(['conversations'], (old) => {
      if (!Array.isArray(old)) return old;
      return old.map(c => (c.id === convId || c.publicId === convId) ? { ...c, isPinned: nextPinned, pinned: nextPinned } : c);
    });
    try {
      await messagesApi.pinConversation(convId, nextPinned);
    } catch (e) {
      queryClient.setQueryData(['conversations'], (old) => {
        if (!Array.isArray(old)) return old;
        return old.map(c => (c.id === convId || c.publicId === convId) ? { ...c, isPinned: isPinnedNow, pinned: isPinnedNow } : c);
      });
    }
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
      if (String(convId).startsWith('c_')) {
        const actualId = convId.replace('c_', '');
        return await communitiesApi.updateGroupInfo(actualId, apiPayload);
      }
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
    if (String(convId).startsWith('c_')) {
      const actualId = convId.replace('c_', '');
      return communitiesApi.removeGroupMember(actualId, memberId).then(() => {
        queryClient.invalidateQueries({ queryKey: ['communities'] });
        queryClient.invalidateQueries({ queryKey: ['conversations'] });
        queryClient.invalidateQueries({ queryKey: ['groupDetails'] });
      });
    }
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
    if (String(convId).startsWith('c_')) {
      const actualId = convId.replace('c_', '');
      return communitiesApi.leave(actualId).then(() => queryClient.invalidateQueries({ queryKey: ['communities'] }));
    }
    await groupApi.leaveGroup(convId);
    queryClient.invalidateQueries({ queryKey: ['conversations'] });
  };
  const updateGroupSettings = async (convId, data) => {
    queryClient.setQueryData(['conversations'], (old) => {
      if (!Array.isArray(old)) return old;
      return old.map(c => (String(c.id) === String(convId) || String(c.publicId) === String(convId) || String(c.internalId) === String(convId)) ? { ...c, ...data } : c);
    });
    queryClient.setQueriesData({ queryKey: ['groupDetails'] }, (old) => {
      if (!old) return old;
      const match = String(old.id) === String(convId) || String(old.publicId) === String(convId) || String(old.internalId) === String(convId);
      return match ? { ...old, ...data } : old;
    });
    if (String(convId).startsWith('c_')) {
      const actualId = String(convId).replace('c_', '');
      return communitiesApi.updateGroupInfo(actualId, data);
    }
    await groupApi.updateSettings(convId, data);
  };

  const updateGroupEditPermission = async (convId, permission) => {
    const updateObj = { editGroupPermission: permission };
    queryClient.setQueryData(['conversations'], (old) => {
      if (!Array.isArray(old)) return old;
      return old.map(c => (String(c.id) === String(convId) || String(c.publicId) === String(convId) || String(c.internalId) === String(convId)) ? { ...c, ...updateObj } : c);
    });
    queryClient.setQueriesData({ queryKey: ['groupDetails'] }, (old) => {
      if (!old) return old;
      const match = String(old.id) === String(convId) || String(old.publicId) === String(convId) || String(old.internalId) === String(convId);
      return match ? { ...old, ...updateObj } : old;
    });
    if (String(convId).startsWith('c_')) {
      const actualId = String(convId).replace('c_', '');
      return communitiesApi.updateGroupInfo(actualId, updateObj);
    }
    await groupApi.updatePermissions(convId, permission);
  };

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

    try {
      await messagesApi.changeOwner(convId, targetUserId);
    } finally {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    }
  };

  const promoteToAdmin = async (convId, targetUserId) => {
    queryClient.setQueryData(['conversations'], (old) => {
      if (!Array.isArray(old)) return old;
      return old.map(c => {
        const isMatch = c.id === convId || c.publicId === convId || c.internalId === convId || String(c.id) === String(convId);
        if (isMatch) {
          const currentAdmins = c.admins || [];
          if (!currentAdmins.includes(targetUserId)) {
            return { ...c, admins: [...currentAdmins, targetUserId] };
          }
        }
        return c;
      });
    });
    await messagesApi.promoteAdmin(convId, targetUserId);
    queryClient.invalidateQueries({ queryKey: ['conversations'] });
  };

  const demoteFromAdmin = async (convId, targetUserId) => {
    queryClient.setQueryData(['conversations'], (old) => {
      if (!Array.isArray(old)) return old;
      return old.map(c => {
        const isMatch = c.id === convId || c.publicId === convId || c.internalId === convId || String(c.id) === String(convId);
        if (isMatch) {
          const currentAdmins = c.admins || [];
          return { ...c, admins: currentAdmins.filter(id => id !== targetUserId) };
        }
        return c;
      });
    });
    await messagesApi.demoteAdmin(convId, targetUserId);
    queryClient.invalidateQueries({ queryKey: ['conversations'] });
  };

  const endGroup = async (convId) => {
    await messagesApi.endGroup(convId);
    queryClient.invalidateQueries({ queryKey: ['conversations'] });
  };

  const acceptGroupJoinRequest = async (convId, targetUserId) => {
    await messagesApi.acceptJoinRequest(convId, targetUserId);
    queryClient.invalidateQueries({ queryKey: ['conversations'] });
  };

  const declineGroupJoinRequest = async (convId, targetUserId) => {
    await messagesApi.declineJoinRequest(convId, targetUserId);
    queryClient.invalidateQueries({ queryKey: ['conversations'] });
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
  };
}
