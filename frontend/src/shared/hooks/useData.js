import { useState, useEffect, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { communitiesApi, activitiesApi, usersApi, messagesApi, postsApi, groupApi, dmApi } from '../api/apiClient';
import { useAuth } from '../context/AuthContext';
import { useSavedActivitiesStore } from '../stores/savedActivitiesStore';
import { processAndUploadImage, uploadFileDirect } from '../utils/mediaPipeline';
import { useDeleteComment } from '../../features/feed/hooks/useDeleteComment';
import { showToast } from '../utils/toast';

// Feature-scoped hooks — useData delegates to these instead of declaring its own queries.
// This makes useData a thin compatibility adapter while the real caching logic lives in
// the feature hooks with proper staleTime, IndexedDB hydration, and invalidation policies.
import { useCommunities } from './useCommunities';
import { useCrewActivities } from './useCrew';
import { useConversations } from './useMessages';
import { useCampusUsers } from './useProfile';
import { useUsersMap } from './useUsersMap';
import { usePostLookup } from './usePostLookup';
import { useMessageActions } from './useMessageActions';
import { useCommunityActions } from './useCommunityActions';
import { useGroupActions } from './useGroupActions';

/**
 * Compatibility adapter — preserves the existing API surface while delegating
 * all data fetching to feature-scoped hooks. Migrate call sites to the specific
 * hooks when touching a component.
 */
export function useData() {
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();
  const { mutate: deleteCommentMutate } = useDeleteComment();
  const savedActivities = useSavedActivitiesStore((state) => state.savedActivities);
  const storeToggleSave = useSavedActivitiesStore((state) => state.toggleSaveActivity);
  const toggleSaveActivity = useCallback(async (id) => {
    await storeToggleSave(id);
    queryClient.invalidateQueries({ queryKey: ['activities', 'bookmarks'] });
  }, [storeToggleSave, queryClient]);

  const deleteComment = (postId, commentId) => deleteCommentMutate({ commentId, postId });

  // ── Delegated queries (no longer declared here) ──────────────────────────
  const { communities: rawCommunities, isLoading: isCommunitiesLoading } = useCommunities();
  // campusCommunities intentionally not fetched here — useData is mounted globally by the Sidebar
  // and firing GET /communities/campus on every page was causing duplicate requests.
  const [isIdleLoaded, setIsIdleLoaded] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsIdleLoaded(true);
    }, 1500);
    return () => clearTimeout(timer);
  }, []);

  // Call useCampusCommunities() directly in the Campus page / feature that needs it.
  const campusCommunities = [];
  // Activities: flat list from infinite query cache
  const { conversations: processedConversations, rawConversations, isLoading: isConversationsLoading, error: conversationsError } = useConversations();
  // Users: small general list (20) for mention lookups; deferred to idle time
  const { data: rawUsers = [] } = useQuery({ queryKey: ['users'], queryFn: () => usersApi.getAll(20, 0), enabled: Boolean(currentUser?.id && isIdleLoaded), staleTime: 5 * 60_000 });
  const { campusUsers: rawCampusUsers } = useCampusUsers(isIdleLoaded ? 50 : 0);

  const conversations = useMemo(
    () => [...(processedConversations || [])],
    [processedConversations]
  );

  // Builder now lives in useCrewActivities() so there is one implementation.
  const crewActivities = useCrewActivities();

  // Aliases for old properties — rawCommunities from useCommunities already has lookup keys
  const communitiesWithLookup = rawCommunities;
  const campusGroups = rawCommunities;

  // Users mapping (legacy support for { [id]: user }) — the builder now lives
  // in useUsersMap() so there is exactly one implementation while both exist.
  const users = useUsersMap();

  const campusUsers = useMemo(() => {
    const map = {};
    (rawCampusUsers || []).forEach(u => { if (u?.id) map[u.id] = u; });
    return map;
  }, [rawCampusUsers]);

  // Mutations
  const joinCommMutation = useMutation({
    mutationFn: (id) => communitiesApi.join(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['communities'] }),
  });

  // Community/post writes now live in useCommunityActions().
  const { createCampusGroup, addCommunity, addPost, updateCommunity } = useCommunityActions();

  const createActivityMutation = useMutation({
    mutationFn: (data) => activitiesApi.create(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['activities'] }),
  });

  const leaveActivityMutation = useMutation({
    mutationFn: (id) => activitiesApi.leave(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['activities'] }),
  });

  
  const addCrewActivity = async (data) => {
    return createActivityMutation.mutateAsync(data);
  };

  const getUserByUsername = (username) => rawUsers.find(u => u.username === username) || null;
  const getUserById = (id) => users[id] || null;

  // getPostById now lives in usePostLookup(); useData delegates to it.
  const getPostById = usePostLookup();

  // These now live in useMessageActions(); useData delegates so there is one
  // implementation while both exist.
  const {
    updateMessagesCache,
    sendDirectMessage,
    start24HrInstantChat,
    reactToMessage,
    startConversation,
    createGroupConversation,
  } = useMessageActions();

  // Group-chat admin actions now live in useGroupActions().
  const {
    togglePinConversation, updateGroupInfo, removeGroupMember, addGroupMember,
    leaveGroup, updateGroupSettings, updateGroupEditPermission, changeGroupOwner,
    promoteToAdmin, demoteFromAdmin, endGroup, acceptGroupJoinRequest,
    declineGroupJoinRequest,
  } = useGroupActions();

  const toggleMuteConversation = async (convId, currentMuted) => {
    queryClient.setQueryData(['conversations'], (old) => {
      if (!Array.isArray(old)) return old;
      return old.map(c => c.id === convId || c.publicId === convId ? { ...c, isMuted: !currentMuted } : c);
    });
    try {
      await messagesApi.muteConversation(convId, !currentMuted);
    } catch (e) {
      queryClient.setQueryData(['conversations'], (old) => {
        if (!Array.isArray(old)) return old;
        return old.map(c => c.id === convId || c.publicId === convId ? { ...c, isMuted: currentMuted } : c);
      });
    }
  };

  const deleteConversation = async (convId) => {
    queryClient.setQueryData(['conversations'], (old) => {
      if (!Array.isArray(old)) return old;
      return old.filter(c => c.id !== convId && c.publicId !== convId);
    });
    try {
      await messagesApi.deleteConversation(convId);
    } catch (e) {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    }
  };

  const clearChat = async (convId) => {
    queryClient.setQueryData(['messages', convId], () => ({ pages: [], pageParams: [] }));
    try {
      await messagesApi.clearChat(convId);
    } catch (e) {
      console.error(e);
    }
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
    queryClient.invalidateQueries({ queryKey: ['conversations'] });
    queryClient.invalidateQueries({ queryKey: ['users'] });
  };

  const joinCrewActivity = (id) => activitiesApi.join(id).then(() => queryClient.invalidateQueries({ queryKey: ['activities'] }));
  const leaveCrewActivity = (id) => leaveActivityMutation.mutateAsync(id);
  const requestToJoinActivity = (id) => activitiesApi.requestToJoinActivity(id).then(() => queryClient.invalidateQueries({ queryKey: ['activities'] }));
  const requestToJoinGroup = (id) => {
    return groupApi.joinGroup(id)
      .catch(() => communitiesApi.join(id))
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ['conversations'] });
        queryClient.invalidateQueries({ queryKey: ['communities'] });
      });
  };
  const cancelCrewActivity = (id) => activitiesApi.cancelCrewActivity(id).then(() => queryClient.invalidateQueries({ queryKey: ['activities'] }));
  const endCrewActivity = cancelCrewActivity;

  const acceptJoinRequest = (id, userId) => activitiesApi.acceptJoinRequest(id, userId).then(() => queryClient.invalidateQueries({ queryKey: ['activities'] }));
  const rejectJoinRequest = (id, userId) => activitiesApi.rejectJoinRequest(id, userId).then(() => queryClient.invalidateQueries({ queryKey: ['activities'] }));
  const declineCrewInvitation = (id) => activitiesApi.declineCrewInvitation(id).then(() => queryClient.invalidateQueries({ queryKey: ['activities'] }));

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
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    } catch (err) {
      showToast(err?.message || 'Retry failed', 'error');
      const isBlockError = err?.message?.toLowerCase().includes('block') || err?.message?.includes('Forbidden');
      queryClient.setQueryData(['messages', convId], (old) => {
        if (!old) return old;
        if (isBlockError) {
          return { ...old, messages: (old.messages || []).filter(m => m.id !== msgId) };
        }
        return { ...old, messages: (old.messages || []).map(m => m.id === msgId ? { ...m, status: 'failed' } : m) };
      });
    }
  };

const updatePollInCache = (oldData, postId, updatedPollOrIndices, currentUserId) => {
  if (!oldData) return oldData;

  const updatePost = (p) => {
    if (p.id !== postId || !p.poll) return p;

    let nextPoll = p.poll;
    if (typeof updatedPollOrIndices === 'object' && updatedPollOrIndices !== null && !Array.isArray(updatedPollOrIndices)) {
      nextPoll = {
        ...p.poll,
        ...updatedPollOrIndices,
        selectedUsers: {
          ...(p.poll.selectedUsers || {}),
          ...(updatedPollOrIndices.selectedUsers || {}),
          ...(currentUserId && updatedPollOrIndices.myVotes ? { [currentUserId]: updatedPollOrIndices.myVotes } : {})
        }
      };
    } else if (Array.isArray(updatedPollOrIndices)) {
      const idx = updatedPollOrIndices[0];
      const currentOptions = p.poll.options || [];
      const updatedOptions = currentOptions.map((opt, i) => {
        if (i === idx) {
          const currentVotes = typeof opt === 'object' ? Number(opt.votes || opt.voteCount || 0) : 0;
          return typeof opt === 'object' ? { ...opt, votes: currentVotes + 1 } : { text: opt, votes: 1 };
        }
        return opt;
      });
      const newTotal = (p.poll.totalVotes || 0) + 1;
      const myVotes = [idx];
      nextPoll = {
        ...p.poll,
        options: updatedOptions,
        totalVotes: newTotal,
        votedOptionIndex: idx,
        myVotes,
        selectedUsers: {
          ...(p.poll.selectedUsers || {}),
          ...(currentUserId ? { [currentUserId]: myVotes } : {})
        }
      };
    }

    return {
      ...p,
      poll: nextPoll,
    };
  };

  if (oldData.id === postId) return updatePost(oldData);
  if (Array.isArray(oldData)) return oldData.map(updatePost);
  if (oldData.posts && Array.isArray(oldData.posts)) return { ...oldData, posts: oldData.posts.map(updatePost) };
  if (oldData.pages) {
    return {
      ...oldData,
      pages: oldData.pages.map(page => {
        if (page.posts) return { ...page, posts: page.posts.map(updatePost) };
        if (page.items) return { ...page, items: page.items.map(updatePost) };
        return page;
      })
    };
  }
  return oldData;
};

  const voteInPoll = async (postId, indices) => {
    const applyCacheUpdate = (pollData) => {
      const updater = (old) => updatePollInCache(old, postId, pollData, currentUser?.id);
      queryClient.setQueriesData({ queryKey: ['feed'] }, updater);
      queryClient.setQueriesData({ queryKey: ['posts'] }, updater);
      queryClient.setQueriesData({ queryKey: ['user-posts'] }, updater);
      queryClient.setQueriesData({ queryKey: ['bookmarks'] }, updater);
      queryClient.setQueriesData({ queryKey: ['community-posts'] }, updater);
      queryClient.setQueryData(['post', postId], updater);
    };

    applyCacheUpdate(indices);

    try {
      const res = await postsApi.voteInPoll(postId, indices);
      if (res?.poll) {
        applyCacheUpdate(res.poll);
      }
      return res;
    } catch (err) {
      showToast(err?.response?.data?.message || err?.message || "Couldn't submit vote", 'error');
      queryClient.invalidateQueries({ queryKey: ['posts'] });
      queryClient.invalidateQueries({ queryKey: ['feed'] });
      queryClient.invalidateQueries({ queryKey: ['user-posts'] });
      queryClient.invalidateQueries({ queryKey: ['community-posts'] });
      queryClient.invalidateQueries({ queryKey: ['post', postId] });
      throw err;
    }
  };


  return {
    currentUser,
    communities: communitiesWithLookup,
    campusGroups,
    users,
    crewActivities,
    posts: [],
    conversations,
    isConversationsLoading,
    conversationsError,
    campusCommunities,
    campusUsers,
    joinCommunity: joinCommMutation.mutate,
    createCampusGroup,
    addCommunity,
    addPost,
    updateCommunity,
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
    cancelCrewActivity,
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
    retryDirectMessage,
    clearChat,
    toggleBlockUser,
    addGroupMember,
    leaveGroup,
    voteInPoll,
    start24HrInstantChat,
    deleteComment,
    savedActivities,
    toggleSaveActivity,
  };
}
