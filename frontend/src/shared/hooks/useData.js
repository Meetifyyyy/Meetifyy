import { useMemo, useCallback } from 'react';
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
import { useActivitiesList, useCampusActivities } from './useCrew';
import { useConversations } from './useMessages';
import { useCampusUsers } from './useProfile';

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
  // Call useCampusCommunities() directly in the Campus page / feature that needs it.
  const campusCommunities = [];
  // Activities: flat list from infinite query cache
  const rawActivities = useActivitiesList();
  const { campusActivities: rawCampusActivities } = useCampusActivities();
  const { conversations: processedConversations, rawConversations, isLoading: isConversationsLoading, error: conversationsError } = useConversations();
  // Users: small general list (20) for mention lookups; campus limited to 50 not 200
  const { data: rawUsers = [] } = useQuery({ queryKey: ['users'], queryFn: () => usersApi.getAll(20, 0), enabled: Boolean(currentUser?.id), staleTime: 5 * 60_000 });
  const { campusUsers: rawCampusUsers } = useCampusUsers(50);

  const conversations = useMemo(() => {
    const actList = [...(rawActivities || []), ...(rawCampusActivities || [])];
    const uniqueActMap = new Map();
    actList.forEach(a => { if (a && a.id) uniqueActMap.set(a.id, a); });

    // Start from processedConversations (already transformed by useConversations hook)
    const list = [...(processedConversations || [])];

    // Augment with activity chat enrichment for activity-type conversations
    list.forEach((c, idx) => {
      if (!c.isActivityChat && !c.activityId) return;
      const cleanActId = c.activityId || (String(c.id).startsWith('act_') ? String(c.id).replace('act_', '') : null);
      const matchedAct = cleanActId ? uniqueActMap.get(cleanActId) : null;
      if (!matchedAct) return;
      const activity = c.activity || matchedAct;
      const actStartDate = activity?.startDate || activity?.date || c.date;
      const actStatus = (activity?.status || c.status || '').toUpperCase();
      const calcHasStarted = actStatus === 'IN_PROGRESS' || actStatus === 'STARTED' || actStatus === 'COMPLETED' || actStatus === 'ENDED' || (actStartDate ? (new Date(actStartDate) <= new Date()) : false);
      list[idx] = {
        ...c,
        activity,
        activityId: c.activityId || (matchedAct ? matchedAct.id : null),
        isActivityChat: true,
        hasStarted: c.hasStarted || calcHasStarted,
        activityHasStarted: c.hasStarted || calcHasStarted,
        avatar: c.avatar || activity?.coverImage || null,
      };
    });

    // Inject virtual activity group chats that have no conversation record yet
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
              activity: act,
              isActivityChat: true,
              hasStarted,
              activityHasStarted: hasStarted,
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
  }, [processedConversations, rawActivities, rawCampusActivities, currentUser?.id]);

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

  // Aliases for old properties — rawCommunities from useCommunities already has lookup keys
  const communitiesWithLookup = rawCommunities;
  const campusGroups = rawCommunities;

  // Users mapping (legacy support for { [id]: user })
  const users = useMemo(() => {
    const map = {};
    (rawUsers || []).forEach(u => { if (u?.id) map[u.id] = u; });
    (rawCampusUsers || []).forEach(u => { if (u?.id) map[u.id] = u; });
    (processedConversations || []).forEach(c => {
      if (c.targetUser?.id) map[c.targetUser.id] = c.targetUser;
      if (c.otherUser?.id) map[c.otherUser.id] = c.otherUser;
      if (Array.isArray(c.participants)) {
        c.participants.forEach(p => {
          if (p?.id && (p?.username || p?.displayName || p?.name)) map[p.id] = p;
          else if (p?.user?.id) map[p.user.id] = p.user;
        });
      }
      if (Array.isArray(c.members)) {
        c.members.forEach(m => {
          if (m?.id && (m?.username || m?.displayName || m?.name)) map[m.id] = m;
          else if (m?.user?.id) map[m.user.id] = m.user;
        });
      }
      if (Array.isArray(c.memberDetails)) {
        c.memberDetails.forEach(m => {
          if (m?.userId) map[m.userId] = { id: m.userId, displayName: m.displayName, username: m.username, avatar: m.avatar };
        });
      }
    });
    return map;
  }, [rawUsers, rawCampusUsers, processedConversations]);

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

  const createCommMutation = useMutation({
    mutationFn: (data) => communitiesApi.create(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['communities'] }),
  });

  const createActivityMutation = useMutation({
    mutationFn: (data) => activitiesApi.create(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['activities'] }),
  });

  const leaveActivityMutation = useMutation({
    mutationFn: (id) => activitiesApi.leave(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['activities'] }),
  });

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
  
  const updateMessagesCache = (convId, updater) => {
    queryClient.setQueryData(['messages', convId], (old) => {
      if (!old) return old;
      if (old.pages) {
        return {
          ...old,
          pages: old.pages.map((p, idx) => idx === 0 ? { ...p, messages: updater(p.messages || []) } : p)
        };
      }
      return { ...old, messages: updater(old.messages || []) };
    });
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
    updateMessagesCache(convId, (msgs) => [...msgs, optimisticMessage]);

    try {
      if (options?.fileObj) {
        const file = options.fileObj;
        if (file.type.startsWith('image/')) {
          const { publicUrl } = await processAndUploadImage(file, 'chat');
          payload.mediaUrl = publicUrl;
        } else {
          const { publicUrl } = await uploadFileDirect(file, 'chat');
          payload.mediaUrl = publicUrl;
        }
      }


      let res;
      if (String(convId).startsWith('c_')) {
        res = await groupApi.sendMessage(String(convId).replace('c_', ''), payload);
      } else {
        res = await dmApi.sendMessage(convId, payload);
      }
      
      const confirmedMsg = {
        ...res,
        from: 'me',
        text: res.text || res.payload?.text || payload.text,
      };

      // Replace optimistic message with confirmed server message
      updateMessagesCache(convId, (msgs) => msgs.map(m => m.id === tempId ? confirmedMsg : m));
      return confirmedMsg;
    } catch (error) {
      // Rollback optimistic message on failure
      updateMessagesCache(convId, (msgs) => msgs.map(m => m.id === tempId ? { ...m, status: 'failed' } : m));
      throw error;
    } finally {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    }
  };

  const normalizeUserIds = (input) => {
    if (Array.isArray(input)) {
      return input.map(item => typeof item === 'string' ? item : (item?.id || item?.userId)).filter(Boolean);
    }
    if (typeof input === 'string') return [input];
    if (typeof input === 'object' && (input.id || input.userId)) return [input.id || input.userId];
    return [];
  };
  const reactToMessage = (messageId, reaction) => messagesApi.reactToMessage(messageId, reaction);

  const startConversation = (targetUserOrIds, name) => {
    let targetUserObj = typeof targetUserOrIds === 'object' && !Array.isArray(targetUserOrIds) ? targetUserOrIds : null;
    const cleanIds = normalizeUserIds(targetUserOrIds);
    const targetUserId = targetUserObj?.id || (Array.isArray(cleanIds) ? cleanIds[0] : cleanIds);

    const existingConv = (conversations || []).find(c => {
      if (c.isGroup || c.isActivityChat || String(c.id).startsWith('act_') || String(c.id).startsWith('c_')) return false;
      const otherId = c.targetUser?.id || c.otherUser?.id || c.userId || c.participants?.find(p => {
        const pId = typeof p === 'string' ? p : (p.id || p.userId || p.user?.id);
        return String(pId) !== String(currentUser?.id);
      })?.userId;
      return String(otherId) === String(targetUserId);
    });

    if (existingConv) {
      return existingConv.publicId || existingConv.id;
    }

    return `draft_${targetUserId}`;
  };

  const createGroupConversation = async (groupName, userIds) => {
    const cleanIds = normalizeUserIds(userIds);

    try {
      const res = await groupApi.createGroup(groupName, cleanIds);
      const realId = res?.publicId || res?.id;
      if (!realId) throw new Error('No conversation ID returned');

      // Inject the real group into the conversation list immediately.
      // The socket will also send conversation:updated to all members,
      // but we pre-populate here so the UI is instant for the creator.
      const newConv = {
        ...res,
        id: realId,
        publicId: realId,
        internalId: res.internalId || realId,
        isGroup: true,
        type: 'GROUP',
        unread: 0,
        unreadCount: 0,
        timestamp: Date.now(),
        updatedAt: res.updatedAt || new Date().toISOString(),
      };

      queryClient.setQueryData(['conversations'], (old) => {
        const list = Array.isArray(old) ? old : [];
        // Remove any stale entry with same ID before injecting
        const filtered = list.filter(c => c.id !== realId && c.publicId !== realId);
        return [newConv, ...filtered];
      });

      return realId;
    } catch (err) {
      console.error('Failed to create group:', err);
      showToast('Failed to create group. Please try again.');
      return null;
    }
  };


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
    if (String(convId).startsWith('act_')) {
      const actualId = convId.replace('act_', '');
      return activitiesApi.leave(actualId).then(() => {
        queryClient.invalidateQueries({ queryKey: ['activities'] });
        queryClient.invalidateQueries({ queryKey: ['conversations'] });
      });
    }
    await groupApi.leaveGroup(convId);
    queryClient.invalidateQueries({ queryKey: ['conversations'] });
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
      showToast(err?.message || 'Retry failed.');
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
      showToast(err?.response?.data?.message || err?.message || 'Failed to submit vote');
      queryClient.invalidateQueries({ queryKey: ['posts'] });
      queryClient.invalidateQueries({ queryKey: ['feed'] });
      queryClient.invalidateQueries({ queryKey: ['user-posts'] });
      queryClient.invalidateQueries({ queryKey: ['community-posts'] });
      queryClient.invalidateQueries({ queryKey: ['post', postId] });
      throw err;
    }
  };

  const start24HrInstantChat = async (candidate, activity) => {
    const res = await messagesApi.startInstantMatchChat(candidate?.id, activity).catch(() => null);
    queryClient.invalidateQueries({ queryKey: ['conversations'] });
    return res?.id || null;
  };

  const addPost = async (text, poll, communityId, media, mentions) => {
    try {
      const mediaKey = media?.url || (typeof media === 'string' ? media : undefined);
      const newPost = await postsApi.createPost({
        text,
        communityId,
        mediaKey,
        mentions,
        poll: poll || undefined,
      });
      queryClient.invalidateQueries({ queryKey: ['posts'] });
      queryClient.invalidateQueries({ queryKey: ['feed'] });
      queryClient.invalidateQueries({ queryKey: ['communities'] });
      if (communityId) {
        queryClient.invalidateQueries({ queryKey: ['community', communityId] });
        queryClient.invalidateQueries({ queryKey: ['community-posts', communityId] });
        queryClient.setQueryData(['community-posts', communityId], (old = []) => {
          if (!newPost) return old;
          const list = Array.isArray(old) ? old : (old?.posts || []);
          if (list.some(p => p.id === newPost.id)) return old;
          return [newPost, ...list];
        });
      }
      return newPost;
    } catch (err) {
      showToast(err?.message || 'Failed to create post');
      throw err;
    }
  };

  const updateCommunity = async (id, data) => {
    try {
      const updated = await communitiesApi.updateGroupInfo(id, data);
      // Seed the cache immediately so the UI reflects the change before the re-fetch lands
      if (updated?.id) {
        queryClient.setQueryData(['community', id], updated);
      }
      queryClient.invalidateQueries({ queryKey: ['communities'] });
      queryClient.invalidateQueries({ queryKey: ['community', id] });
      return updated;
    } catch (err) {
      showToast(err?.message || 'Failed to update community');
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
    campusCrewActivities,
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
