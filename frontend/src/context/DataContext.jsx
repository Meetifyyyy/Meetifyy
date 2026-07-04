import { createContext, useContext, useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { initialUsers, initialPosts } from '../data/mockData';
import { communities as initialCommunities } from '../data/communities';
import { initialMessages } from '../data/messages';
import { generateCrewActivities } from '../components/crew/crewData';
import { useAuth } from './AuthContext';
import { parseTimeString } from '../utils/time';

const DataContext = createContext(null);

export function DataProvider({ children }) {
  const { currentUser, updateCurrentUser } = useAuth();

  // Compute once, not at module level, so it's inside React lifecycle
  const [users, setUsers] = useState(() => {
    const saved = localStorage.getItem('meetifyy_users');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        Object.keys(parsed).forEach(username => {
          const u = parsed[username];
          if (!u.followingList) u.followingList = [];
          if (!u.followersList) u.followersList = [];
        });
        return parsed;
      } catch (e) {
        console.error(e);
      }
    }
    const initialized = { ...initialUsers };
    Object.keys(initialized).forEach(username => {
      const u = initialized[username];
      if (!u.followingList) u.followingList = [];
      if (!u.followersList) u.followersList = [];
    });
    return initialized;
  });

  const [posts, setPosts] = useState(() => {
    const mapWithTimestamps = (items) => items.map(item => ({
      ...item,
      createdAt: item.createdAt || parseTimeString(item.time),
      replies: item.replies ? mapWithTimestamps(item.replies) : undefined
    }));

    const saved = localStorage.getItem('meetifyy_posts');
    if (saved) {
      try {
        return mapWithTimestamps(JSON.parse(saved));
      } catch (e) {
        console.error(e);
      }
    }
    const commPosts = Object.values(initialCommunities).flatMap(comm =>
      comm.posts.map((p, i) => ({
        id: p.id || `c_post_${comm.id}_${i}`,
        authorId: p.authorId || 'u1',
        time: p.time,
        text: p.text,
        likes: p.likes || 0,
        comments: p.comments || 0,
        isLikedByMe: false,
        replies: [],
        communityId: comm.id
      }))
    );
    return mapWithTimestamps([...initialPosts, ...commPosts]);
  });

  const [communitiesState, setCommunitiesState] = useState(() => {
    const saved = localStorage.getItem('meetifyy_communities');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error(e);
      }
    }
    return initialCommunities;
  });

  const [conversations, setConversations] = useState(() => {
    const saved = localStorage.getItem('meetifyy_conversations');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error(e);
      }
    }
    return initialMessages;
  });

  const [crewActivities, setCrewActivities] = useState(() => {
    const saved = localStorage.getItem('meetifyy_crew_activities');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error(e);
      }
    }
    return generateCrewActivities(initialUsers);
  });

  const [savedActivities, setSavedActivities] = useState(() => {
    const saved = localStorage.getItem('meetifyy_saved_activities');
    return saved ? JSON.parse(saved) : [];
  });

  // Persist states to localStorage when changed
  useEffect(() => {
    localStorage.setItem('meetifyy_users', JSON.stringify(users));
  }, [users]);

  useEffect(() => {
    localStorage.setItem('meetifyy_posts', JSON.stringify(posts));
  }, [posts]);

  useEffect(() => {
    localStorage.setItem('meetifyy_communities', JSON.stringify(communitiesState));
  }, [communitiesState]);

  useEffect(() => {
    localStorage.setItem('meetifyy_conversations', JSON.stringify(conversations));
  }, [conversations]);

  useEffect(() => {
    localStorage.setItem('meetifyy_crew_activities', JSON.stringify(crewActivities));
  }, [crewActivities]);

  useEffect(() => {
    localStorage.setItem('meetifyy_saved_activities', JSON.stringify(savedActivities));
  }, [savedActivities]);

  // Dynamic seed: Ensure the current user has some crew invitations if they are logged in
  useEffect(() => {
    if (currentUser && currentUser.id && crewActivities && crewActivities.length > 0) {
      const userInvitedCount = crewActivities.filter(a => a.invitedUsers && a.invitedUsers.includes(currentUser.id)).length;
      const sessionKey = `meetifyy_seeded_invites_${currentUser.id}`;
      if (!sessionStorage.getItem(sessionKey) && userInvitedCount === 0) {
        sessionStorage.setItem(sessionKey, 'true');
        let count = 0;
        const updated = crewActivities.map(a => {
          const invited = a.invitedUsers || [];
          if (a.hostId !== currentUser.id && count < 2 && !a.participants.includes(currentUser.id)) {
            count++;
            return {
              ...a,
              invitedUsers: [...invited, currentUser.id]
            };
          }
          return {
            ...a,
            invitedUsers: invited
          };
        });
        if (count > 0) {
          setCrewActivities(updated);
        }
      }
    }
  }, [currentUser, crewActivities]);

  // Sync: Ensure the current user has temporary chats for any activities they've already joined
  useEffect(() => {
    if (!currentUser) return;

    setConversations(prevConvs => {
      let changed = false;
      const newConvs = [...prevConvs];

      crewActivities.forEach(act => {
        if (act.participants?.includes(currentUser.id) || act.hostId === currentUser.id) {
          const actChatId = `act_${act.id}`;
          const existing = newConvs.find(c => c.id === actChatId);
          
          if (!existing) {
            newConvs.unshift({
              id: actChatId,
              name: act.title,
              isActivityChat: true,
              activityId: act.id,
              color: 'var(--color-primary)',
              online: true,
              lastMsg: 'Group chat created!',
              time: 'Just now',
              unread: 0,
              messages: [],
              participants: act.participants || []
            });
            changed = true;
          } else if (!existing.participants?.includes(currentUser.id)) {
            const idx = newConvs.findIndex(c => c.id === actChatId);
            if (idx !== -1) {
              newConvs[idx] = {
                ...existing,
                participants: [...(existing.participants || []), currentUser.id]
              };
              changed = true;
            }
          }
        }
      });

      return changed ? newConvs : prevConvs;
    });
  }, [currentUser, crewActivities]);

  // Helper for stable object comparison
  const stableStringify = (obj) => {
    if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
    if (Array.isArray(obj)) return JSON.stringify(obj);
    return JSON.stringify(Object.keys(obj).sort().reduce((acc, key) => {
      acc[key] = obj[key];
      return acc;
    }, {}));
  };

  const currentUserRef = useRef(currentUser);
  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);

  // Sync: merge currentUser changes from AuthContext into DataContext users list
  useEffect(() => {
    if (currentUser && currentUser.username) {
      setUsers(prev => {
        const existing = prev[currentUser.username];
        if (!existing) {
          return {
            ...prev,
            [currentUser.username]: {
              followingList: [],
              followersList: [],
              ...currentUser
            }
          };
        } else {
          // Compare only non-list fields to prevent erasing followingList/followersList
          const comp1 = { ...currentUser };
          const comp2 = { ...existing };
          delete comp1.followingList;
          delete comp1.followersList;
          delete comp2.followingList;
          delete comp2.followersList;
          if (stableStringify(comp1) !== stableStringify(comp2)) {
            return {
              ...prev,
              [currentUser.username]: {
                ...existing,
                ...currentUser
              }
            };
          }
        }
        return prev;
      });
    }
  }, [currentUser]);

  // Sync: push DataContext users list changes for current user back to AuthContext
  useEffect(() => {
    const cu = currentUserRef.current;
    if (cu && cu.username && updateCurrentUser) {
      const liveUser = users[cu.username];
      if (liveUser) {
        if (stableStringify(liveUser) !== stableStringify(cu)) {
          updateCurrentUser(liveUser);
        }
      }
    }
  }, [users, updateCurrentUser]);

  // Notification callback — set by NotificationBridge to avoid circular deps
  const onNotifyRef = useRef(null);
  const setOnNotify = useCallback((fn) => { onNotifyRef.current = fn; }, []);
  const notify = useCallback((type, payload) => {
    if (onNotifyRef.current) onNotifyRef.current(type, payload);
  }, []);

  const enrichCommunity = useCallback((comm) => {
    if (!comm) return comm;
    return {
      ...comm,
      get growth() { return comm.newMembersThisWeek > 0 ? `+${comm.newMembersThisWeek} this week` : ''; }
    };
  }, []);

  const enrichUser = useCallback((user) => {
    if (!user) return user;
    return {
      ...user,
      get communitiesJoined() { return user.communities?.length || 0; },
      get eventsAttended() { return user.activityLog?.filter(a => a.type === 'event').length || 0; },
      get postsThisMonth() { return posts.filter(p => p.authorId === user.id).length; }
    };
  }, [posts]);

  const getUserByUsername = useCallback((uName) => {
    const u = Object.values(users).find(u => u.username === uName) || null;
    return enrichUser(u);
  }, [users, enrichUser]);

  const getUserById = useCallback((id) => {
    const u = Object.values(users).find(u => u.id === id) || null;
    return enrichUser(u);
  }, [users, enrichUser]);

  const getPostById = useCallback((postId) => {
    return posts.find(p => p.id === postId) || null;
  }, [posts]);

  const getUserPosts = useCallback((authorId) => {
    return posts.filter(p => p.authorId === authorId);
  }, [posts]);

  const likePost = useCallback(async (postId) => {
    setPosts(prev => {
      const updated = prev.map(p => {
        if (p.id === postId) {
          const likedBy = p.likedBy || [];
          const isLiked = likedBy.includes(currentUser?.id);
          const newLikedBy = isLiked 
            ? likedBy.filter(id => id !== currentUser?.id)
            : [...likedBy, currentUser?.id];

          // Notify on like (not unlike), and not on own posts
          if (!isLiked && p.authorId !== currentUser?.id) {
            notify('like', { postId, actorId: currentUser?.id, postAuthorId: p.authorId, text: 'liked your post' });
          }

          const diff = isLiked ? -1 : 1;

          return { 
            ...p, 
            likedBy: newLikedBy,
            likes: Math.max(0, (p.likes || 0) + diff),
            isLikedByMe: !isLiked
          };
        }
        return p;
      });
      return updated;
    });
  }, [currentUser, notify]);

  const addPost = useCallback(async (text, poll, communityId = null, media = null) => {
    await new Promise(resolve => setTimeout(resolve, 600));

    const newPost = {
      id: `post_${Date.now()}`,
      authorId: currentUser.id,
      createdAt: Date.now(),
      time: 'just now',
      text,
      media,
      poll: poll ? {
        ...poll,
        votes: poll.options.map(() => 0),
        selectedUsers: {}
      } : undefined,
      likedBy: [],
      likes: 0,
      comments: 0,
      replies: [],
      communityId: communityId || undefined
    };
    
    if (!Object.values(users).find(u => u.id === currentUser.id)) {
      setUsers(prev => ({ ...prev, [currentUser.username]: currentUser }));
    }

    setPosts(prev => [newPost, ...prev]);
  }, [currentUser, users]);

  const deletePost = useCallback(async (postId) => {
    await new Promise(resolve => setTimeout(resolve, 400));
    setPosts(prev => prev.filter(p => p.id !== postId));
  }, []);

  const editPost = useCallback(async (postId, newText) => {
    await new Promise(resolve => setTimeout(resolve, 300));
    setPosts(prev => prev.map(p => {
      if (p.id === postId) {
        return { ...p, text: newText };
      }
      return p;
    }));
  }, []);

  const addComment = useCallback(async (postId, text, parentCommentId = null) => {
    await new Promise(resolve => setTimeout(resolve, 600));
    setPosts(prev => prev.map(p => {
      if (p.id !== postId) return p;

      // Notify post author about the comment (not on own posts)
      if (p.authorId !== currentUser.id) {
        notify('comment', { postId, actorId: currentUser.id, postAuthorId: p.authorId, text: 'replied to your post' });
      }

      const newReply = {
        id: `r_${Date.now()}`,
        authorId: currentUser.id,
        createdAt: Date.now(),
        time: 'just now',
        text,
        likedBy: [],
        likes: 0,
        isLikedByMe: false,
        replies: []
      };

      if (!parentCommentId) {
        return {
          ...p,
          comments: p.comments + 1,
          replies: [newReply, ...(p.replies || [])]
        };
      }

      const addReplyToNode = (nodes) => {
        return nodes.map(node => {
          if (node.id === parentCommentId) {
            return {
              ...node,
              replies: [...(node.replies || []), newReply]
            };
          } else if (node.replies && node.replies.length > 0) {
            return {
              ...node,
              replies: addReplyToNode(node.replies)
            };
          }
          return node;
        });
      };

      return {
        ...p,
        comments: p.comments + 1,
        replies: addReplyToNode(p.replies || [])
      };
    }));

    if (!Object.values(users).find(u => u.id === currentUser.id)) {
      setUsers(prev => ({ ...prev, [currentUser.username]: currentUser }));
    }
  }, [currentUser, users, notify]);

  const likeComment = useCallback(async (postId, commentId) => {
    setPosts(prev => prev.map(p => {
      if (p.id !== postId) return p;

      const toggleLikeInNode = (nodes) => {
        return nodes.map(node => {
          if (node.id === commentId) {
            const likedBy = node.likedBy || [];
            const isLiked = likedBy.includes(currentUser?.id);
            const newLikedBy = isLiked 
              ? likedBy.filter(id => id !== currentUser?.id)
              : [...likedBy, currentUser?.id];

            const diff = isLiked ? -1 : 1;

            return {
              ...node,
              likedBy: newLikedBy,
              likes: Math.max(0, (node.likes || 0) + diff),
              isLikedByMe: !isLiked
            };
          } else if (node.replies && node.replies.length > 0) {
            return {
              ...node,
              replies: toggleLikeInNode(node.replies)
            };
          }
          return node;
        });
      };

      return {
        ...p,
        replies: toggleLikeInNode(p.replies || [])
      };
    }));
  }, [currentUser]);

  const deleteComment = useCallback(async (postId, commentId) => {
    await new Promise(resolve => setTimeout(resolve, 400));
    setPosts(prev => prev.map(p => {
      if (p.id !== postId) return p;

      let removed = false;
      const filterNode = (nodes) => {
        const filtered = nodes.filter(node => {
          if (node.id === commentId) {
            removed = true;
            return false;
          }
          return true;
        });

        return filtered.map(node => {
          if (node.replies && node.replies.length > 0) {
            return {
              ...node,
              replies: filterNode(node.replies)
            };
          }
          return node;
        });
      };

      const newReplies = filterNode(p.replies || []);
      return {
        ...p,
        comments: removed ? Math.max(0, p.comments - 1) : p.comments,
        replies: newReplies
      };
    }));
  }, []);

  const voteInPoll = useCallback(async (postId, optionIndices) => {
    await new Promise(resolve => setTimeout(resolve, 300));
    setPosts(prev => prev.map(p => {
      if (p.id !== postId || !p.poll) return p;
      
      const currentSelected = p.poll.selectedUsers?.[currentUser.id] || [];
      if (currentSelected.length > 0) return p;

      const nextVotes = [...(p.poll.votes || p.poll.options.map(() => 0))];
      optionIndices.forEach(idx => {
        nextVotes[idx] += 1;
      });

      return {
        ...p,
        poll: {
          ...p.poll,
          votes: nextVotes,
          selectedUsers: {
            ...(p.poll.selectedUsers || {}),
            [currentUser.id]: optionIndices
          }
        }
      };
    }));
  }, [currentUser]);

  const toggleJoinCommunity = useCallback(async (communityId) => {
    await new Promise(resolve => setTimeout(resolve, 400));

    setCommunitiesState(prevComm => {
      const commToUpdate = prevComm[communityId];
      if (!commToUpdate) return prevComm;

      const userCommunities = users[currentUser.username]?.communities || currentUser.communities || [];
      const commName = commToUpdate.name;
      const isJoined = userCommunities.includes(commName);

      if (!isJoined && commToUpdate.bannedUsers && commToUpdate.bannedUsers[currentUser.id]) {
        const banExpiry = commToUpdate.bannedUsers[currentUser.id];
        if (Date.now() < banExpiry) {
          // User is currently banned
          return prevComm;
        }
      }

      // Notify on join (not leave)
      if (!isJoined) {
        notify('community_join', { communityId, actorId: currentUser?.id, text: `joined ${commName}` });
      }

      setUsers(prevUsers => {
        const user = prevUsers[currentUser.username] || currentUser;
        const nextCommunities = isJoined
          ? (user.communities || []).filter(c => c !== commName)
          : [...(user.communities || []), commName];
        return {
          ...prevUsers,
          [currentUser.username]: {
            ...user,
            communities: nextCommunities
          }
        };
      });

      const currentMemberInfo = {
        id: currentUser.id,
        name: currentUser.displayName || currentUser.username || 'Member',
        avatar: currentUser.avatar || currentUser.displayName?.charAt(0) || currentUser.username?.charAt(0) || 'U',
        role: 'Member',
        admin: false
      };
      const newMemberList = isJoined
        ? (commToUpdate.memberList || []).filter(m => m.id !== currentUser.id)
        : [...(commToUpdate.memberList || []), currentMemberInfo];
      const newMemberAvatars = isJoined
        ? (commToUpdate.memberAvatars || []).filter(a => a !== currentMemberInfo.avatar)
        : [...(commToUpdate.memberAvatars || []), currentMemberInfo.avatar];

      return {
        ...prevComm,
        [communityId]: {
          ...commToUpdate,
          members: isJoined ? commToUpdate.members - 1 : commToUpdate.members + 1,
          memberList: newMemberList,
          memberAvatars: newMemberAvatars
        }
      };
    });
  }, [currentUser, users, notify]);

  const addCommunity = useCallback(async (communityData) => {
    await new Promise(resolve => setTimeout(resolve, 300));
    const id = 'c_' + Date.now();
    const newComm = {
      id,
      ...communityData,
      members: 1,
      isUniversity: false,
      memberList: [{
        id: currentUser.id,
        name: currentUser.displayName,
        avatar: currentUser.avatar,
        role: 'Creator',
        admin: true
      }],
      bannedUsers: {}
    };
    setCommunitiesState(prev => ({ ...prev, [id]: newComm }));
    
    // Auto join the community
    updateCurrentUser({
      communities: [...(currentUser.communities || []), newComm.name]
    });

    return id;
  }, [currentUser, updateCurrentUser]);

  const updateCommunity = useCallback(async (communityId, updates) => {
    await new Promise(resolve => setTimeout(resolve, 300));
    setCommunitiesState(prev => {
      const comm = prev[communityId];
      if (!comm) return prev;
      return {
        ...prev,
        [communityId]: { ...comm, ...updates }
      };
    });
  }, []);

  const kickMember = useCallback(async (communityId, userIdToKick) => {
    await new Promise(resolve => setTimeout(resolve, 300));
    setCommunitiesState(prev => {
      const comm = prev[communityId];
      if (!comm) return prev;
      
      const newMemberList = (comm.memberList || []).filter(m => m.id !== userIdToKick);
      const newBannedUsers = {
        ...(comm.bannedUsers || {}),
        [userIdToKick]: Date.now() + 7 * 24 * 60 * 60 * 1000 // 7 days from now
      };

      return {
        ...prev,
        [communityId]: { 
          ...comm, 
          memberList: newMemberList,
          bannedUsers: newBannedUsers,
          members: Math.max(0, comm.members - 1)
        }
      };
    });
  }, []);

  const updateFollowerCount = useCallback((targetUsername, isFollowingNow) => {
    setUsers(prevUsers => {
      const targetUser = prevUsers[targetUsername];
      const me = prevUsers[currentUser?.username] || currentUser;
      if (!targetUser || !me) return prevUsers;

      return {
        ...prevUsers,
        [targetUsername]: {
          ...targetUser,
          followers: Math.max(0, (targetUser.followers || 0) + (isFollowingNow ? 1 : -1))
        },
        [me.username]: {
          ...me,
          following: Math.max(0, (me.following || 0) + (isFollowingNow ? 1 : -1))
        }
      };
    });
  }, [currentUser]);

  const toggleFollow = useCallback((targetUsername) => {
    if (!currentUser || !currentUser.username || targetUsername === currentUser.username) return;

    setUsers(prevUsers => {
      const me = prevUsers[currentUser.username] || currentUser;
      const target = prevUsers[targetUsername];
      if (!me || !target) return prevUsers;

      const myFollowing = me.followingList || [];
      const targetFollowers = target.followersList || [];
      const isFollowingNow = !myFollowing.includes(targetUsername);

      const nextMyFollowing = isFollowingNow
        ? [...myFollowing, targetUsername]
        : myFollowing.filter(u => u !== targetUsername);

      const nextTargetFollowers = isFollowingNow
        ? [...targetFollowers, me.username]
        : targetFollowers.filter(u => u !== me.username);

      // Notify on follow
      if (isFollowingNow) {
        notify('follow', { targetUsername, actorId: me.id, text: 'started following you' });
      }

      return {
        ...prevUsers,
        [me.username]: {
          ...me,
          followingList: nextMyFollowing,
          following: Math.max(0, (me.following || 0) + (isFollowingNow ? 1 : -1))
        },
        [targetUsername]: {
          ...target,
          followersList: nextTargetFollowers,
          followers: Math.max(0, (target.followers || 0) + (isFollowingNow ? 1 : -1))
        }
      };
    });
  }, [currentUser, notify]);

  const sendDirectMessage = useCallback(async (convId, text, replyTo = null, inviteData = null) => {
    await new Promise(resolve => setTimeout(resolve, 300));
    const now = new Date();
    const timeStr = now.getHours() + ':' + (now.getMinutes() < 10 ? '0' : '') + now.getMinutes();

    setConversations((prev) => {
      const convIndex = prev.findIndex(c => c.id === convId);
      if (convIndex === -1) return prev;
      
      const updatedConv = {
        ...prev[convIndex],
        messages: [
          ...prev[convIndex].messages,
          { 
            from: 'me', 
            text, 
            time: timeStr, 
            replyTo: replyTo ? { text: replyTo.text, from: replyTo.from } : null,
            inviteData: inviteData || null
          }
        ],
        lastMsg: text,
        time: 'now',
      };
      
      const newConvs = [...prev];
      newConvs.splice(convIndex, 1);
      newConvs.unshift(updatedConv); // Move to top
      return newConvs;
    });
  }, []);

  const reactToMessage = useCallback(async (convId, messageIndex, reaction) => {
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== convId) return c;
        const updatedMessages = c.messages.map((m, idx) => {
          if (idx !== messageIndex) return m;
          const currentReactions = m.reactions || [];
          const exists = currentReactions.includes(reaction);
          const newReactions = exists
            ? currentReactions.filter((r) => r !== reaction)
            : [...currentReactions, reaction];
          return { ...m, reactions: newReactions };
        });
        return { ...c, messages: updatedMessages };
      })
    );
  }, []);

  const clearChat = useCallback(async (convId) => {
    await new Promise(resolve => setTimeout(resolve, 300));
    setConversations((prev) =>
      prev.map((c) =>
        c.id === convId
          ? { ...c, messages: [], lastMsg: 'Chat cleared', time: 'now' }
          : c
      )
    );
  }, []);

  const toggleBlockUser = useCallback(async (convId) => {
    await new Promise(resolve => setTimeout(resolve, 300));
    setConversations((prev) =>
      prev.map((c) =>
        c.id === convId
          ? { ...c, blocked: !c.blocked }
          : c
      )
    );
  }, []);

  const startConversation = useCallback(async (targetUser) => {
    const targetName = targetUser.displayName || targetUser.name;
    const targetUsername = targetUser.username || targetUser.id || targetName;
    const targetAvatar = targetUser.avatar || (targetName ? targetName.charAt(0).toUpperCase() : '?');

    await new Promise(resolve => setTimeout(resolve, 300));

    // Match by username/id first (stable), fall back to name for legacy conversations
    const existingConv = conversations.find(c => 
      (c.username && c.username === targetUsername) || 
      (!c.username && c.name === targetName)
    );
    if (existingConv) return existingConv.id;

    const newId = Date.now();
    const newConv = {
      id: newId,
      name: targetName,
      username: targetUsername,
      avatar: targetAvatar,
      color: 'var(--color-primary)',
      online: true,
      lastMsg: 'Say hi!',
      time: 'Just now',
      unread: 0,
      messages: []
    };
    
    setConversations(prev => [newConv, ...prev]);
    return newId;
  }, [conversations]);

  const joinCrewActivity = useCallback(async (activityId) => {
    await new Promise(resolve => setTimeout(resolve, 400));
    setCrewActivities(prev => prev.map(a => {
      if (a.id !== activityId) return a;
      const alreadyJoined = a.participants.includes(currentUser?.id);
      if (alreadyJoined) return a;

      notify('crew_join', { activityId, actorId: currentUser?.id, targetId: a.hostId, text: `joined ${a.title}` });

      return {
        ...a,
        slotsFilled: Math.min(a.slotsFilled + 1, a.slotsNeeded),
        participants: [...a.participants, currentUser?.id],
        invitedUsers: (a.invitedUsers || []).filter(uid => uid !== currentUser?.id)
      };
    }));

    // Manage activity conversation
    setConversations(prev => {
      const activityChatId = `act_${activityId}`;
      const existingConv = prev.find(c => c.id === activityChatId);
      
      if (existingConv) {
        // Add user to participants if not already and inject system message
        if (!existingConv.participants?.includes(currentUser?.id)) {
          const sysMsg = { id: Date.now(), type: 'system', text: `@${currentUser?.username || 'someone'} has joined`, time: 'Just now' };
          return prev.map(c => c.id === activityChatId ? {
            ...c,
            participants: [...(c.participants || []), currentUser?.id],
            messages: [...(c.messages || []), sysMsg]
          } : c);
        }
        return prev;
      } else {
        // Find activity title to name the chat
        const act = crewActivities.find(a => a.id === activityId);
        const title = act ? act.title : 'Activity Chat';
        const sysMsg = { id: Date.now(), type: 'system', text: `@${currentUser?.username || 'someone'} has joined`, time: 'Just now' };
        const newConv = {
          id: activityChatId,
          name: title,
          isActivityChat: true,
          activityId: activityId,
          color: 'var(--color-primary)',
          online: true,
          lastMsg: 'Group chat created!',
          time: 'Just now',
          unread: 0,
          messages: [sysMsg],
          participants: [currentUser?.id]
        };
        return [newConv, ...prev];
      }
    });

  }, [currentUser, notify, crewActivities]);

  const requestToJoinActivity = useCallback((activityId) => {
    setCrewActivities(prev => prev.map(a => {
      if (a.id === activityId) {
        return {
          ...a,
          pendingRequests: [...(a.pendingRequests || []), currentUser?.id]
        };
      }
      return a;
    }));
    
    // Find activity to get host ID
    const activity = crewActivities.find(a => a.id === activityId);
    if (activity && activity.hostId) {
      notify('ACTIVITY_JOIN_REQUEST', {
        activityId,
        actorId: currentUser?.id,
        targetUsername: activity.hostId, // Using targetUsername for routing if needed, but actorId is what NotificationContext checks for the sender
        text: `requested to join your activity "${activity.title}".`,
      });
    }
  }, [currentUser, notify, crewActivities]);

  const acceptJoinRequest = useCallback((activityId, requesterId) => {
    // 1. Remove from pendingRequests and add to participants
    setCrewActivities(prev => prev.map(a => {
      if (a.id === activityId) {
        return {
          ...a,
          pendingRequests: (a.pendingRequests || []).filter(id => id !== requesterId),
          participants: [...(a.participants || []), requesterId],
          slotsFilled: (a.slotsFilled || 0) + 1
        };
      }
      return a;
    }));

    // 2. Add to group chat and send system message
    const activityChatId = `act_${activityId}`;
    setConversations(prev => {
      const existing = prev.find(c => c.id === activityChatId);
      if (existing) {
        const requester = Object.values(users).find(u => u.id === requesterId);
        const reqName = requester ? requester.username : 'someone';
        const sysMsg = { id: Date.now(), type: 'system', text: `@${reqName} has joined`, time: 'Just now' };
        
        return prev.map(c => c.id === activityChatId ? {
          ...c,
          participants: [...(c.participants || []), requesterId],
          messages: [...(c.messages || []), sysMsg]
        } : c);
      }
      return prev; // If it doesn't exist, we don't worry about it here
    });

  }, [users]);

  const declineCrewInvitation = useCallback(async (activityId) => {
    await new Promise(resolve => setTimeout(resolve, 300));
    setCrewActivities(prev => prev.map(a => {
      if (a.id !== activityId) return a;
      return {
        ...a,
        invitedUsers: (a.invitedUsers || []).filter(uid => uid !== currentUser?.id)
      };
    }));
  }, [currentUser]);

  const addCrewActivity = useCallback((newActivity) => {
    setCrewActivities(prev => [newActivity, ...prev]);

    // Create a temporary group chat for this activity
    const activityChatId = `act_${newActivity.id}`;
    const newConv = {
      id: activityChatId,
      name: newActivity.title,
      isActivityChat: true,
      activityId: newActivity.id,
      color: 'var(--color-primary)',
      online: true,
      lastMsg: 'Group chat created!',
      time: 'Just now',
      unread: 0,
      messages: [],
      participants: [currentUser?.id]
    };
    setConversations(prev => [newConv, ...prev]);
  }, [currentUser]);

  const createGroupConversation = useCallback(async (groupName, userIds) => {
    await new Promise(resolve => setTimeout(resolve, 300));
    
    const directMembers = [];
    const invitedMembers = [];
    const myFollowers = currentUser?.followersList || [];
    
    for (const uid of userIds) {
      const u = Object.values(users).find(usr => usr.id === uid);
      if (u && myFollowers.includes(u.username)) {
        directMembers.push(uid);
      } else if (u) {
        invitedMembers.push(u);
      }
    }

    const newId = 'g_' + Date.now();
    const newConv = {
      id: newId,
      name: groupName,
      isGroup: true,
      adminId: currentUser?.id,
      members: [currentUser?.id, ...directMembers],
      avatar: null, // No default avatar yet, or can use name initials
      color: 'var(--color-secondary)',
      online: true,
      lastMsg: 'Group created',
      time: 'Just now',
      unread: 0,
      description: '',
      createdAt: Date.now(),
      messages: []
    };
    setConversations(prev => [newConv, ...prev]);

    // Send invites to non-followers
    for (const u of invitedMembers) {
      const dmConvId = await startConversation(u);
      sendDirectMessage(dmConvId, `I've invited you to join the group "${groupName}".`, null, {
        groupId: newId,
        groupName: groupName
      });
    }

    return newId;
  }, [currentUser, users, startConversation, sendDirectMessage]);

  const startInstantMatch = useCallback(async (preferences) => {
    // Mocking the match search with a delay
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    let allUsers = Object.values(users).filter(u => u.id !== currentUser?.id);
    let matchedActivities = [];
    
    if (preferences.activity) {
      const query = preferences.activity.toLowerCase();
      allUsers = allUsers.map(u => {
        let score = 0;
        if (u.interests && u.interests.some(i => i.toLowerCase().includes(query))) score += 5;
        if (u.skills && u.skills.some(s => s.toLowerCase().includes(query))) score += 3;
        if (u.bio && u.bio.toLowerCase().includes(query)) score += 1;
        return { ...u, matchScore: score };
      });
      allUsers.sort((a, b) => b.matchScore - a.matchScore);
      
      // Intelligent search for similar activities
      const allActivities = crewActivities.filter(a => a.hostId !== currentUser?.id && !(a.participants || []).includes(currentUser?.id));
      const scoredActivities = allActivities.map(a => {
        let score = 0;
        if (a.title && a.title.toLowerCase().includes(query)) score += 5;
        if (a.category && a.category.toLowerCase().includes(query)) score += 4;
        if (a.tags && a.tags.some(t => t.toLowerCase().includes(query))) score += 3;
        if (a.description && a.description.toLowerCase().includes(query)) score += 2;
        return { ...a, matchScore: score };
      });
      
      matchedActivities = scoredActivities.filter(a => a.matchScore > 0).sort((a, b) => b.matchScore - a.matchScore).slice(0, 3);
      
      if (matchedActivities.length === 0 && allActivities.length > 0) {
        // Fallback: Suggest some popular activities if no direct match found
        matchedActivities = [...allActivities].sort((a, b) => b.slotsFilled - a.slotsFilled).slice(0, 2);
      }
    }
    
    let numPeople = 3;
    if (preferences.people === '1 Person') numPeople = 1;
    else if (preferences.people === 'Small Group (4-8)') numPeople = 5;
    else if (preferences.people === 'Doesn\'t Matter') numPeople = 4;

    const matchedUsers = allUsers.slice(0, numPeople);
      
    return {
      activity: preferences.activity,
      users: matchedUsers,
      activities: matchedActivities,
      distance: '2 km away',
      joinedTime: '3 mins ago'
    };
  }, [users, currentUser, crewActivities]);

  const createTemporaryGroupChat = useCallback(async (activityName, userIds) => {
    await new Promise(resolve => setTimeout(resolve, 300));
    
    const newId = 't_' + Date.now();
    const newConv = {
      id: newId,
      name: activityName,
      isGroup: true,
      isTemporary: true,
      expiresAt: Date.now() + 4 * 60 * 60 * 1000, // 4 hours from now
      adminId: currentUser?.id,
      members: [currentUser?.id, ...userIds],
      avatar: null,
      color: '#6366f1',
      online: true,
      lastMsg: 'Temporary room created',
      time: 'Just now',
      unread: 0,
      description: `Instant Match for ${activityName}`,
      createdAt: Date.now(),
      messages: []
    };
    setConversations(prev => [newConv, ...prev]);
    return newId;
  }, [currentUser]);

  const updateGroupInfo = useCallback(async (convId, newName, newAvatar, newDescription) => {
    setConversations(prev => prev.map(c => 
      c.id === convId ? { 
        ...c, 
        name: newName !== undefined ? newName : c.name, 
        avatar: newAvatar !== undefined ? newAvatar : c.avatar,
        description: newDescription !== undefined ? newDescription : c.description
      } : c
    ));
  }, []);

  const addGroupMember = useCallback(async (convId, userId) => {
    setConversations(prev => prev.map(c => {
      if (c.id === convId && !c.members.includes(userId)) {
        return { ...c, members: [...c.members, userId] };
      }
      return c;
    }));
  }, []);

  const removeGroupMember = useCallback(async (convId, userId) => {
    setConversations(prev => prev.map(c => {
      if (c.id === convId) {
        return { ...c, members: c.members.filter(id => id !== userId) };
      }
      return c;
    }));
  }, []);

  const leaveGroup = useCallback(async (convId) => {
    setConversations(prev => prev.map(c => {
      if (c.id === convId) {
        return { ...c, members: c.members.filter(id => id !== currentUser?.id) };
      }
      return c;
    }));
  }, [currentUser]);

  const [searchQuery, setSearchQuery] = useState('');
  const liveCurrentUser = enrichUser(users[currentUser?.username] || currentUser);
  
  // Enrich all communities before providing them
  const enrichedCommunities = Object.keys(communitiesState).reduce((acc, key) => {
    acc[key] = enrichCommunity(communitiesState[key]);
    return acc;
  }, {});

  // Enrich conversations with latest user avatars/names
  const enrichedConversations = useMemo(() => {
    return conversations.map(conv => {
      if (conv.isGroup) return conv;
      
      const targetUser = conv.username 
        ? users[conv.username] 
        : Object.values(users).find(u => u.displayName === conv.name || u.name === conv.name);
        
      if (targetUser) {
        return {
          ...conv,
          name: targetUser.displayName || targetUser.name || conv.name,
          avatar: targetUser.avatarUrl || targetUser.avatar || conv.avatar
        };
      }
      return conv;
    });
  }, [conversations, users]);

  const toggleSaveActivity = useCallback((activityId) => {
    setSavedActivities(prev => 
      prev.includes(activityId) 
        ? prev.filter(id => id !== activityId)
        : [...prev, activityId]
    );
  }, []);

  return (
    <DataContext.Provider value={{
      users,
      posts,
      communities: enrichedCommunities,
      conversations: enrichedConversations,
      crewActivities,
      savedActivities,
      toggleSaveActivity,
      currentUser: liveCurrentUser,
      searchQuery,
      setSearchQuery,
      getUserByUsername,
      getUserById,
      getPostById,
      getUserPosts,
      likePost,
      addPost,
      deletePost,
      editPost,
      addCommunity,
      addComment,
      deleteComment,
      likeComment,
      voteInPoll,
      toggleJoinCommunity,
      updateCommunity,
      kickMember,
      updateFollowerCount,
      toggleFollow,
      sendDirectMessage,
      reactToMessage,
      clearChat,
      toggleBlockUser,
      startConversation,
      createGroupConversation,
      updateGroupInfo,
      addGroupMember,
      removeGroupMember,
      leaveGroup,
      joinCrewActivity,
      requestToJoinActivity,
      acceptJoinRequest,
      declineCrewInvitation,
      addCrewActivity,
      startInstantMatch,
      createTemporaryGroupChat,
      setOnNotify
    }}>
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within DataProvider');
  return ctx;
}
