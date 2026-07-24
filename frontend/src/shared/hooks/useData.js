import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { communitiesApi, activitiesApi, usersApi, messagesApi, postsApi } from '../api/apiClient';
import { useAuth } from '../context/AuthContext';
import { useSavedPostsStore } from '../stores/savedPostsStore';
import { supabase } from '../context/AuthContext';
import { toast } from 'sonner';

/**
 * A centralized hook to bridge the old DataContext API with React Query.
 * This restores functionality to components that were broken when DataContext was removed.
 */
export function useData() {
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();

  // Queries
  const { data: communities = [] } = useQuery({ queryKey: ['communities'], queryFn: communitiesApi.getAll, staleTime: 30_000 });
  const { data: rawActivities = [] } = useQuery({ queryKey: ['activities'], queryFn: activitiesApi.getAll, staleTime: 30_000 });
  const { data: rawConversations = [], isLoading: isConversationsLoading, error: conversationsError } = useQuery({ queryKey: ['conversations'], queryFn: messagesApi.getConversations, staleTime: 10_000 });
  const { data: rawUsers = [] } = useQuery({ queryKey: ['users'], queryFn: () => usersApi.getAll(50, 0), staleTime: 60_000 });

  const conversations = useMemo(() => {
    return (rawConversations || []).map(c => ({
      ...c,
      blocked: c.blocked || false,
      isBlockedByMe: c.isBlockedByMe || false,
      isBlockedByThem: c.isBlockedByThem || false,
      lastMsg: c.lastMessage?.text || '',
      timestamp: c.lastMessage?.createdAt ? new Date(c.lastMessage.createdAt).getTime() : (c.updatedAt ? new Date(c.updatedAt).getTime() : 0),
      unread: c.unreadCount || c.unread || 0,
      online: c.targetUser?.isOnline || false,
      isGroup: c.type === 'GROUP',
      name: c.name || c.targetUser?.displayName || c.targetUser?.username || 'Chat',
      avatar: c.avatar || c.targetUser?.avatar || null,
      username: c.targetUser?.username || null,
      userId: c.targetUser?.id || null,
    }));
  }, [rawConversations]);

  // Map backend activity structure to frontend expectations
  const crewActivities = rawActivities.map(a => {
    const startDate = a.startDate ? new Date(a.startDate) : null;
    const dateFormatted = startDate ? startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null;
    const dateLabelFormatted = startDate ? startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null;
    const timeFormatted = startDate ? startDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : null;

    return {
      ...a,
      date: a.startDate || null,
      dateFormatted,
      dateLabel: dateLabelFormatted,
      time: timeFormatted,
      hostId: a.creatorId,
      hostName: a.members?.find(m => m.userId === a.creatorId)?.user?.displayName || 'Host',
      hostUsername: a.members?.find(m => m.userId === a.creatorId)?.user?.username || 'host',
      hostAvatar: a.members?.find(m => m.userId === a.creatorId)?.user?.avatar || '',
      participants: a.members?.filter(m => m.status === 'MEMBER').map(m => m.userId) || [],
      pendingRequests: a.members?.filter(m => m.status === 'PENDING').map(m => m.userId) || [],
      slotsFilled: a.members?.filter(m => m.status === 'MEMBER').length || 1,
      slotsNeeded: a.maxMembers || 999,
      _membersData: a.members?.map(m => m.user) || [] // Keep full user objects for UI
    };
  });

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
  const sendDirectMessage = async (convId, text, replyTo = null, mentions = [], mediaUrl = null, mediaType = null, explicitLinkPreview = null, explicitInviteData = null) => {
    const res = await messagesApi.sendDirectMessage(convId, {
      text,
      replyToId: replyTo?.id || null,
      mentions,
      mediaUrl,
      mediaType,
      inviteData: explicitInviteData
    });
    queryClient.invalidateQueries({ queryKey: ['messages', convId] });
    queryClient.invalidateQueries({ queryKey: ['conversations'] });
    return res;
  };
  const reactToMessage = (messageId, reaction) => messagesApi.reactToMessage(messageId, reaction);
  const startConversation = (userIds, name) => messagesApi.startConversation(userIds, name).then(res => res.id);
  const createGroupConversation = async (groupName, userIds) => {
    const res = await messagesApi.startConversation(userIds, groupName);
    queryClient.invalidateQueries(['conversations']);
    return res.id;
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
    if (String(convId).startsWith('c_')) {
      const actualId = convId.replace('c_', '');
      return communitiesApi.updateGroupInfo(actualId, { name, description, avatarKey }).then(() => queryClient.invalidateQueries(['communities']));
    }
    await messagesApi.updateGroup(convId, { name, description, avatarKey });
    queryClient.invalidateQueries(['conversations']);
  };

  const removeGroupMember = async (convId, memberId) => {
    if (String(convId).startsWith('c_')) {
      const actualId = convId.replace('c_', '');
      return communitiesApi.removeGroupMember(actualId, memberId).then(() => queryClient.invalidateQueries(['communities']));
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
  const requestToJoinGroup = (id) => communitiesApi.join(id).then(() => queryClient.invalidateQueries(['communities']));
  const endCrewActivity = (id) => activitiesApi.endCrewActivity(id).then(() => queryClient.invalidateQueries(['activities']));
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
    toggleJoinCommunity,
    toggleJoinCampusGroup,
    createCampusGroup,
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
