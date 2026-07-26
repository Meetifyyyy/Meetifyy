import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { communitiesApi, activitiesApi, usersApi, messagesApi, postsApi } from '../api/apiClient';
import { useAuth } from '../context/AuthContext';
import { useSavedPostsStore } from '../stores/savedPostsStore';
import { supabase } from '../context/AuthContext';
import { toast } from 'sonner';
import { processAndUploadImage, uploadFileDirect } from '../utils/mediaPipeline';

/**
 * A centralized hook to bridge the old DataContext API with React Query.
 * This restores functionality to components that were broken when DataContext was removed.
 */
export function useData() {
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();

  // Queries
  const { data: communities = [] } = useQuery({ queryKey: ['communities'], queryFn: communitiesApi.getAll, staleTime: 30_000 });
  const { data: campusCommunities = [] } = useQuery({ queryKey: ['campusCommunities'], queryFn: communitiesApi.getCampusCommunities, staleTime: 30_000 });
  const { data: rawActivities = [] } = useQuery({ queryKey: ['activities'], queryFn: activitiesApi.getAll, staleTime: 30_000 });
  const { data: rawCampusActivities = [] } = useQuery({ queryKey: ['campusActivities'], queryFn: activitiesApi.getCampusActivities, staleTime: 30_000 });
  const { data: rawConversations = [], isLoading: isConversationsLoading, error: conversationsError } = useQuery({ queryKey: ['conversations'], queryFn: messagesApi.getConversations, staleTime: 10_000 });
  const { data: rawUsers = [] } = useQuery({ queryKey: ['users'], queryFn: () => usersApi.getAll(50, 0), staleTime: 60_000 });
  const { data: rawCampusUsers = [] } = useQuery({ queryKey: ['campusUsers'], queryFn: () => usersApi.getCampusUsers(200, 0), staleTime: 60_000 });

  const conversations = useMemo(() => {
    const list = (rawConversations || []).map(c => {
      const pList = c.participants || c.members || [];
      const calculatedIsMember = (!c.type || c.type === 'DIRECT') 
        ? true 
        : pList.some(p => {
            const id = typeof p === 'string' ? p : (p.id || p.userId);
            return String(id) === String(currentUser?.id);
          });
      const isMember = c.isMember !== undefined ? c.isMember : calculatedIsMember;
      const isGroup = c.type === 'GROUP' || c.isGroup;

      return {
        ...c,
        internalId: c.internalId || c.id,
        isMember,
        blocked: c.blocked || false,
        isBlockedByMe: c.isBlockedByMe || false,
        isBlockedByThem: c.isBlockedByThem || false,
        lastMsg: (() => {
          if (!c.lastMessage) return '';
          if (c.lastMessage.text) return c.lastMessage.text;
          if (c.lastMessage.mediaUrl) {
            if (c.lastMessage.mediaType === 'image') return 'Photo';
            if (c.lastMessage.mediaType === 'video') return 'Video';
            return 'Audio';
          }
          return '';
        })(),
        lastSenderId: c.lastMessage?.senderId || null,
        lastSenderName: c.lastMessage?.senderName || null,
        timestamp: c.lastMessage?.createdAt ? new Date(c.lastMessage.createdAt).getTime() : (c.updatedAt ? new Date(c.updatedAt).getTime() : 0),
        unread: c.unreadCount || c.unread || 0,
        online: isGroup ? false : (c.targetUser?.isOnline || false),
        isGroup,
        name: isGroup ? (c.name || 'Group Chat') : (c.name || c.targetUser?.displayName || c.targetUser?.username || 'Chat'),
        avatar: isGroup ? (c.avatarKey || c.avatar || null) : (c.avatar || c.targetUser?.avatar || null),
        username: isGroup ? null : (c.targetUser?.username || null),
        userId: isGroup ? null : (c.targetUser?.id || null),
        targetUser: isGroup ? null : c.targetUser
      };
    });

    const actList = [...(rawActivities || []), ...(rawCampusActivities || [])];
    const uniqueActMap = new Map();
    actList.forEach(a => { if (a && a.id) uniqueActMap.set(a.id, a); });

    uniqueActMap.forEach((act) => {
      const hasGroup = act.createActivityGroup ?? act.createEventGroup ?? false;
      if (hasGroup) {
        const actConvId = `act_${act.id}`;
        const existsInRaw = list.some(c => String(c.id) === String(act.id) || String(c.id) === actConvId || String(c.activityId) === String(act.id));
        if (!existsInRaw) {
          const isParticipant = act.creatorId === currentUser?.id || 
            (act.members && act.members.some(m => m.userId === currentUser?.id && m.status === 'MEMBER'));
          if (isParticipant) {
            const hostObj = act.creator || act.members?.find(m => m.userId === act.creatorId)?.user;
            const hasStarted = act.startDate ? (new Date(act.startDate) <= new Date()) : false;
            list.push({
              id: actConvId,
              publicId: actConvId,
              internalId: act.id,
              activityId: act.id,
              isActivityChat: true,
              isGroup: true,
              isMember: true,
              name: act.title,
              avatar: act.coverImage || hostObj?.avatar || '/default_avatar.webp',
              unread: 0,
              lastMsg: hasStarted ? 'Activity has started!' : 'Activity group chat created',
              timestamp: act.createdAt ? new Date(act.createdAt).getTime() : Date.now(),
              participants: act.members?.map(m => m.user || { id: m.userId }) || [],
              creatorId: act.creatorId,
              hostName: hostObj?.displayName || hostObj?.username || 'Host',
            });
          }
        }
      }
    });

    return list;
  }, [rawConversations, rawActivities, rawCampusActivities, currentUser?.id]);

  const mapActivity = (a) => {
    const startDate = a.startDate ? new Date(a.startDate) : null;
    const endDate = a.endDate ? new Date(a.endDate) : null;

    const dateFormatted = startDate ? startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null;
    const dateLabelFormatted = startDate ? startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null;
    const timeFormatted = startDate ? startDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : null;

    const endDateFormatted = endDate ? endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null;
    const endTimeFormatted = endDate ? endDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : null;

    return {
      ...a,
      date: a.startDate || null,
      endDate: a.endDate || null,
      dateFormatted,
      dateLabel: dateLabelFormatted,
      time: timeFormatted,
      endTime: endTimeFormatted,
      endDateFormatted,
      hostId: a.creatorId,
      hostName: a.creator?.displayName || a.members?.find(m => m.userId === a.creatorId)?.user?.displayName || 'Host',
      hostUsername: a.creator?.username || a.members?.find(m => m.userId === a.creatorId)?.user?.username || 'host',
      hostAvatar: a.creator?.avatar || a.members?.find(m => m.userId === a.creatorId)?.user?.avatar || '',
      participants: a.members?.filter(m => m.status === 'MEMBER').map(m => m.userId) || [],
      pendingRequests: a.members?.filter(m => m.status === 'PENDING').map(m => m.userId) || [],
      slotsFilled: a.members?.filter(m => m.status === 'MEMBER').length || 1,
      slotsNeeded: a.maxMembers || 999,
      _membersData: a.members?.map(m => m.user) || [] // Keep full user objects for UI
    };
  };
  
  const crewActivities = rawActivities.map(mapActivity);
  const campusCrewActivities = rawCampusActivities.map(mapActivity);

  // Aliases for old properties
  const communitiesWithLookup = useMemo(() => {
    const arr = [...communities];
    communities.forEach(c => {
      if (c && c.id) {
        arr[c.id] = c;
      }
    });
    return arr;
  }, [communities]);

  const campusGroups = communitiesWithLookup;

  // Users mapping (legacy support for { [id]: user })
  const users = useMemo(() => {
    const map = {};
    rawUsers.forEach(u => {
      map[u.id] = u;
    });
    return map;
  }, [rawUsers]);

  const campusUsers = useMemo(() => {
    const map = {};
    rawCampusUsers.forEach(u => {
      map[u.id] = u;
    });
    return map;
  }, [rawCampusUsers]);
  const posts = [];

  // Mutations
  const joinCommMutation = useMutation({
    mutationFn: (id) => communitiesApi.join(id),
    onSuccess: () => queryClient.invalidateQueries(['communities']),
  });

  const leaveCommMutation = useMutation({
    mutationFn: (id) => communitiesApi.leave(id),
    onSuccess: () => queryClient.invalidateQueries(['communities']),
  });
  
  const createCommMutation = useMutation({
    mutationFn: (data) => communitiesApi.create(data),
    onSuccess: () => queryClient.invalidateQueries(['communities']),
  });

  const createActivityMutation = useMutation({
    mutationFn: (data) => activitiesApi.create(data),
    onSuccess: () => queryClient.invalidateQueries(['activities']),
  });
  
  const leaveActivityMutation = useMutation({
    mutationFn: (id) => activitiesApi.leave(id),
    onSuccess: () => queryClient.invalidateQueries(['activities']),
  });

  const toggleJoinCommunity = (id, isJoined) => {
    if (isJoined) leaveCommMutation.mutate(id);
    else joinCommMutation.mutate(id);
  };
  
  const toggleJoinCampusGroup = toggleJoinCommunity;
  
  const createCampusGroup = async (name, desc, avatar) => {
    const res = await createCommMutation.mutateAsync({ name, description: desc, avatarKey: avatar });
    return res.id;
  };

  const addCommunity = async (data) => {
    const res = await createCommMutation.mutateAsync({
      name: data.name,
      description: data.desc,
      avatarKey: data.avatar,
      isCampusCommunity: data.isCampusCommunity
    });
    return res.id;
  };
  
  const addCrewActivity = async (data) => {
    return createActivityMutation.mutateAsync(data);
  };

  const getUserByUsername = (username) => rawUsers.find(u => u.username === username) || null;
  const getUserById = (id) => users[id] || null;
  const getPostById = (id) => {
    if (!id) return null;
    const cachedQueries = queryClient.getQueriesData({});
    for (const [, data] of cachedQueries) {
      if (!data) continue;
      if (data.id === id) return data;
      if (Array.isArray(data.posts)) {
        const found = data.posts.find((p) => p && p.id === id);
        if (found) return found;
      }
      if (Array.isArray(data.pages)) {
        for (const page of data.pages) {
          const list = Array.isArray(page?.posts) ? page.posts : (Array.isArray(page?.items) ? page.items : []);
          const found = list.find((p) => p && p.id === id);
          if (found) return found;
        }
      }
      if (Array.isArray(data)) {
        const found = data.find((p) => p && p.id === id);
        if (found) return found;
      }
    }
    return null;
  };
  const { savedPosts, toggleSavePost } = useSavedPostsStore();
  const likePost = async (postId) => {
    await postsApi.likePost(postId);
    queryClient.invalidateQueries(['feed']);
    queryClient.invalidateQueries(['posts']);
    queryClient.invalidateQueries(['user-posts']);
    queryClient.invalidateQueries(['post', postId]);
  };
  const unlikePost = async (postId) => {
    await postsApi.unlikePost(postId);
    queryClient.invalidateQueries(['feed']);
    queryClient.invalidateQueries(['posts']);
    queryClient.invalidateQueries(['user-posts']);
    queryClient.invalidateQueries(['post', postId]);
  };
  const likeComment = async (postId, commentId) => {
    await postsApi.likeComment(commentId);
    if (postId) queryClient.invalidateQueries(['post', postId]);
    queryClient.invalidateQueries(['feed']);
  };
  const unlikeComment = async (postId, commentId) => {
    await postsApi.unlikeComment(commentId);
    if (postId) queryClient.invalidateQueries(['post', postId]);
    queryClient.invalidateQueries(['feed']);
  };

  // API Implementations
  const sendDirectMessage = async (convId, text, replyTo = null, mentions = [], mediaUrl = null, mediaType = null, explicitLinkPreview = null, explicitInviteData = null, options = null) => {
    let payload = {};
    if (text && typeof text === 'object' && !Array.isArray(text)) {
      payload = text;
    } else {
      payload = {
        text: typeof text === 'string' ? text : '',
        replyToId: replyTo?.id || null,
        mentions: Array.isArray(mentions) ? mentions : [],
        mediaUrl: typeof mediaUrl === 'string' ? mediaUrl : null,
        mediaType: typeof mediaType === 'string' ? mediaType : null,
        inviteData: explicitInviteData || (mentions && typeof mentions === 'object' && !Array.isArray(mentions) ? mentions : null)
      };
    }

    const tempId = options?.tempId || `temp_${Date.now()}`;
    const optimisticMessage = {
      id: tempId,
      conversationId: convId,
      text: payload.text,
      mediaUrl: payload.mediaUrl,
      mediaType: payload.mediaType,
      mentions: payload.mentions,
      inviteData: payload.inviteData,
      replyTo,
      senderId: currentUser?.id,
      senderName: currentUser?.displayName || currentUser?.username,
      senderAvatar: currentUser?.avatar,
      from: 'me',
      status: 'sending',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      timestamp: Date.now(),
      createdAt: new Date().toISOString()
    };

    // Optimistically update cache
    queryClient.setQueryData(['messages', convId], (old) => {
      if (!old) return { messages: [optimisticMessage] };
      return { ...old, messages: [...(old.messages || []), optimisticMessage] };
    });

    try {
      if (options?.fileObj) {
        const file = options.fileObj;
        if (file.type.startsWith('image/')) {
          const { publicUrl } = await processAndUploadImage(file, 'messages');
          payload.mediaUrl = publicUrl;
        } else {
          const { publicUrl } = await uploadFileDirect(file, 'messages');
          payload.mediaUrl = publicUrl;
        }
      }

      const res = await messagesApi.sendDirectMessage(convId, payload);
      // Replace optimistic message with confirmed server message
      queryClient.setQueryData(['messages', convId], (old) => {
        if (!old) return { messages: [res] };
        return {
          ...old,
          messages: old.messages.map(m => m.id === tempId ? { ...res, from: 'me' } : m)
        };
      });
      return res;
    } catch (error) {
      // Rollback optimistic message on failure
      queryClient.setQueryData(['messages', convId], (old) => {
        if (!old) return old;
        return {
          ...old,
          messages: old.messages.map(m => m.id === tempId ? { ...m, status: 'error' } : m)
        };
      });
      throw error;
    } finally {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    }
  };
  const normalizeUserIds = (input) => {
    if (!input) return [];
    if (Array.isArray(input)) {
      return input.map(item => typeof item === 'string' ? item : (item?.id || item?.userId)).filter(Boolean);
    }
    if (typeof input === 'string') return [input];
    if (typeof input === 'object' && (input.id || input.userId)) return [input.id || input.userId];
    return [];
  };
  const reactToMessage = (messageId, reaction) => messagesApi.reactToMessage(messageId, reaction);
  const startConversation = async (userIds, name) => {
    const res = await messagesApi.startConversation(normalizeUserIds(userIds), name);
    queryClient.invalidateQueries(['conversations']);
    return res?.id || res?.publicId;
  };
  const createGroupConversation = async (groupName, userIds) => {
    const res = await messagesApi.startConversation(normalizeUserIds(userIds), groupName);
    queryClient.invalidateQueries(['conversations']);
    return res?.id || res?.publicId;
  };
  const togglePinConversation = async (convId, currentPinned) => {
    await messagesApi.pinConversation(convId, !currentPinned);
    queryClient.invalidateQueries(['conversations']);
  };
  const toggleMuteConversation = async (convId, currentMuted) => {
    await messagesApi.muteConversation(convId, !currentMuted);
    queryClient.invalidateQueries(['conversations']);
  };
  const deleteConversation = async (convId) => {
    await messagesApi.deleteConversation(convId);
    queryClient.invalidateQueries(['conversations']);
  };
  const clearChat = async (convId) => {
    await messagesApi.clearChat(convId);
    queryClient.invalidateQueries(['messages', convId]);
    queryClient.invalidateQueries(['conversations']);
  };
  const toggleBlockUser = async (targetUserId, currentlyBlocked) => {
    queryClient.setQueryData(['conversations'], (old) => {
      if (!Array.isArray(old)) return old;
      return old.map(c => {
        if (c.targetUser?.id === targetUserId || c.userId === targetUserId) {
          return {
            ...c,
            blocked: !currentlyBlocked,
            isBlockedByMe: !currentlyBlocked,
            isBlockedByThem: false,
          };
        }
        return c;
      });
    });

    if (currentlyBlocked) {
      await usersApi.unblockUser(targetUserId).catch(() => {});
    } else {
      await usersApi.blockUser(targetUserId).catch(() => {});
    }
    queryClient.invalidateQueries(['conversations']);
    queryClient.invalidateQueries(['users']);
  };
  const updateGroupInfo = async (convId, name, avatarKey, description) => {
    queryClient.setQueryData(['conversations'], (old) => {
      if (!Array.isArray(old)) return old;
      return old.map(c => {
        if (c.id === convId) {
          return {
            ...c,
            ...(name !== undefined ? { name } : {}),
            ...(description !== undefined ? { description } : {}),
            ...(avatarKey !== undefined ? { avatar: avatarKey, avatarKey } : {})
          };
        }
        return c;
      });
    });
    if (String(convId).startsWith('c_')) {
      const actualId = convId.replace('c_', '');
      return communitiesApi.updateGroupInfo(actualId, { name, description, avatarKey }).then(() => {
        queryClient.invalidateQueries(['communities']);
        queryClient.invalidateQueries(['conversations']);
      });
    }
    await messagesApi.updateGroup(convId, { name, description, avatarKey });
    queryClient.invalidateQueries(['conversations']);
  };

  const removeGroupMember = async (convId, memberId) => {
    queryClient.setQueryData(['conversations'], (old) => {
      if (!Array.isArray(old)) return old;
      return old.map(c => {
        if (c.id === convId) {
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
        queryClient.invalidateQueries(['communities']);
        queryClient.invalidateQueries(['conversations']);
      });
    }
    await messagesApi.removeMember(convId, memberId);
    queryClient.invalidateQueries(['conversations']);
  };

  const addGroupMember = async (convId, targetUserId) => {
    await messagesApi.addMember(convId, targetUserId);
    queryClient.invalidateQueries(['conversations']);
  };

  const leaveGroup = async (convId) => {
    if (String(convId).startsWith('c_')) {
      const actualId = convId.replace('c_', '');
      return communitiesApi.leave(actualId).then(() => queryClient.invalidateQueries(['communities']));
    }
    if (String(convId).startsWith('act_')) {
      const actualId = convId.replace('act_', '');
      return activitiesApi.leave(actualId).then(() => queryClient.invalidateQueries(['activities']));
    }
    await messagesApi.leaveGroup(convId);
    queryClient.invalidateQueries(['conversations']);
  };

  const joinCrewActivity = (id) => activitiesApi.join(id).then(() => queryClient.invalidateQueries(['activities']));
  const leaveCrewActivity = (id) => leaveActivityMutation.mutateAsync(id);
  const requestToJoinActivity = (id) => activitiesApi.requestToJoinActivity(id).then(() => queryClient.invalidateQueries(['activities']));
  const requestToJoinGroup = (id) => {
    return messagesApi.requestToJoinGroup(id)
      .catch(() => communitiesApi.join(id))
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ['conversations'] });
        queryClient.invalidateQueries({ queryKey: ['communities'] });
      });
  };
  const endCrewActivity = (id) => activitiesApi.endCrewActivity(id).then(() => queryClient.invalidateQueries(['activities']));

  const updateGroupSettings = async (convId, data) => {
    queryClient.setQueryData(['conversations'], (old) => {
      if (!Array.isArray(old)) return old;
      return old.map(c => c.id === convId ? { ...c, ...data } : c);
    });
    if (String(convId).startsWith('c_')) {
      const actualId = String(convId).replace('c_', '');
      return communitiesApi.updateGroupInfo(actualId, data).then(() => {
        queryClient.invalidateQueries(['communities']);
        queryClient.invalidateQueries(['conversations']);
      });
    }
    await messagesApi.updateSettings(convId, data);
    queryClient.invalidateQueries(['conversations']);
  };

  const updateGroupEditPermission = async (convId, permission) => {
    queryClient.setQueryData(['conversations'], (old) => {
      if (!Array.isArray(old)) return old;
      return old.map(c => c.id === convId ? { ...c, editGroupPermission: permission } : c);
    });
    if (String(convId).startsWith('c_')) {
      const actualId = String(convId).replace('c_', '');
      return communitiesApi.updateGroupInfo(actualId, { editGroupPermission: permission }).then(() => {
        queryClient.invalidateQueries(['communities']);
        queryClient.invalidateQueries(['conversations']);
      });
    }
    await messagesApi.updatePermissions(convId, permission);
    queryClient.invalidateQueries(['conversations']);
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
      queryClient.invalidateQueries(['conversations']);
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
    queryClient.invalidateQueries(['conversations']);
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
    queryClient.invalidateQueries(['conversations']);
  };

  const endGroup = async (convId) => {
    await messagesApi.endGroup(convId);
    queryClient.invalidateQueries(['conversations']);
  };

  const acceptGroupJoinRequest = async (convId, targetUserId) => {
    await messagesApi.acceptJoinRequest(convId, targetUserId);
    queryClient.invalidateQueries(['conversations']);
  };

  const declineGroupJoinRequest = async (convId, targetUserId) => {
    await messagesApi.declineJoinRequest(convId, targetUserId);
    queryClient.invalidateQueries(['conversations']);
  };
  const acceptJoinRequest = (id, userId) => activitiesApi.acceptJoinRequest(id, userId).then(() => queryClient.invalidateQueries(['activities']));
  const rejectJoinRequest = (id, userId) => activitiesApi.rejectJoinRequest(id, userId).then(() => queryClient.invalidateQueries(['activities']));
  const declineCrewInvitation = (id) => activitiesApi.declineCrewInvitation(id).then(() => queryClient.invalidateQueries(['activities']));

  const retryDirectMessage = async (convId, msgId) => {
    const cachedData = queryClient.getQueryData(['messages', convId]);
    const msgs = cachedData?.messages || [];
    const targetMsg = msgs.find(m => m.id === msgId);
    if (!targetMsg) return;

    queryClient.setQueryData(['messages', convId], (old) => {
      if (!old) return old;
      return {
        ...old,
        messages: (old.messages || []).map(m => m.id === msgId ? { ...m, status: 'sending' } : m)
      };
    });

    try {
      const res = await messagesApi.sendDirectMessage(convId, {
        text: targetMsg.text,
        replyToId: targetMsg.replyTo?.id || null,
        mentions: targetMsg.mentions || [],
        mediaUrl: targetMsg.mediaUrl || null,
        mediaType: targetMsg.mediaType || null,
      });

      queryClient.setQueryData(['messages', convId], (old) => {
        if (!old) return old;
        return {
          ...old,
          messages: (old.messages || []).map(m => m.id === msgId ? { ...res, from: 'me' } : m)
        };
      });
      queryClient.invalidateQueries(['conversations']);
    } catch (err) {
      toast.error(err?.message || 'Retry failed.');
      const isBlockError = err?.message?.toLowerCase().includes('block') || err?.message?.includes('Forbidden');
      queryClient.setQueryData(['messages', convId], (old) => {
        if (!old) return old;
        if (isBlockError) {
          return {
            ...old,
            messages: (old.messages || []).filter(m => m.id !== msgId)
          };
        }
        return {
          ...old,
          messages: (old.messages || []).map(m => m.id === msgId ? { ...m, status: 'failed' } : m)
        };
      });
    }
  };
  const initializeCampusGroupConversation = () => {};

  const addComment = async (postId, text, parentId = null, mentions = []) => {
    await postsApi.addComment(postId, { text, parentId, mentions });
    queryClient.invalidateQueries(['posts']);
    queryClient.invalidateQueries(['feed']);
    queryClient.invalidateQueries(['post', postId]);
  };

  const voteInPoll = async (postId, indices) => {
    await postsApi.voteInPoll(postId, indices);
    queryClient.invalidateQueries(['posts']);
    queryClient.invalidateQueries(['feed']);
  };

  const start24HrInstantChat = async (candidate, activity) => {
    const res = await messagesApi.startInstantMatchChat(candidate?.id, activity).catch(() => null);
    queryClient.invalidateQueries(['conversations']);
    return res?.id || null;
  };

  return {
    currentUser,
    communities: communitiesWithLookup,
    campusGroups,
    users,
    crewActivities,
    posts,
    conversations,
    isConversationsLoading,
    conversationsError,
    campusCommunities,
    campusCrewActivities,
    campusUsers,
    joinCommunity: joinCommMutation.mutate,
    toggleJoinCommunity,
    toggleJoinCampusGroup,
    createCampusGroup,
    addCommunity,
    sendDirectMessage,
    reactToMessage,
    startConversation,
    createGroupConversation,
    togglePinConversation,
    toggleMuteConversation,
    deleteConversation,
    addCrewActivity,
    joinCrewActivity,
    leaveCrewActivity,
    requestToJoinActivity,
    requestToJoinGroup,
    endCrewActivity,
    updateGroupSettings,
    updateGroupEditPermission,
    changeGroupOwner,
    promoteToAdmin,
    demoteFromAdmin,
    endGroup,
    acceptGroupJoinRequest,
    declineGroupJoinRequest,
    acceptJoinRequest,
    rejectJoinRequest,
    declineCrewInvitation,
    getUserByUsername,
    getUserById,
    getPostById,
    updateGroupInfo,
    removeGroupMember,
    savedPosts,
    toggleSavePost,
    likePost,
    unlikePost,
    likeComment,
    unlikeComment,
    retryDirectMessage,
    clearChat,
    toggleBlockUser,
    addGroupMember,
    initializeCampusGroupConversation,
    leaveGroup,
    addComment,
    voteInPoll,
    start24HrInstantChat,
  };
}
