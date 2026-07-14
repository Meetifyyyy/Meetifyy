import { createContext, useContext, useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { initialUsers, initialPosts } from '@data/mockData';
import { communities as initialCommunities } from '@data/communities';
import { initialMessages } from '@data/messages';
import { generateCrewActivities } from '@features/crew/data/crewData';
import defaultCover from '@assets/images/default_cover.png';
import { useAuth } from './AuthContext';
import { parseTimeString } from '@shared/utils/time';
import { getLinkPreview } from '@shared/utils/linkPreview';
import { canSeeOnlineStatus } from '@shared/utils/presence';

const DataContext = createContext(null);

export function DataProvider({ children }) {
  const { currentUser, updateCurrentUser } = useAuth();

  // Compute once, not at module level, so it's inside React lifecycle
  const [users, setUsers] = useState(() => {
    const USERS_SEED_VERSION = '2';
    if (localStorage.getItem('meetifyy_users_seed_v') !== USERS_SEED_VERSION) {
      localStorage.removeItem('meetifyy_users');
      localStorage.setItem('meetifyy_users_seed_v', USERS_SEED_VERSION);
    }
    const saved = localStorage.getItem('meetifyy_users');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        Object.keys(parsed).forEach(username => {
          const u = parsed[username];
          if (!u.followingList) u.followingList = [];
          if (!u.followersList) u.followersList = [];
          if (u.isOnline === undefined) {
            u.isOnline = !!u.recentlyActive;
          }
          if (u.lastActive === undefined) {
            u.lastActive = u.isOnline ? Date.now() : Date.now() - 4 * 60 * 60 * 1000;
          }
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
      if (u.isOnline === undefined) {
        u.isOnline = !!u.recentlyActive;
      }
      if (u.lastActive === undefined) {
        u.lastActive = u.isOnline ? Date.now() : Date.now() - 4 * 60 * 60 * 1000;
      }
    });
    return initialized;
  });

  const [posts, setPosts] = useState(() => {
    const mapWithTimestamps = (items) => items.map(item => ({
      ...item,
      createdAt: item.createdAt || parseTimeString(item.time),
      replies: item.replies ? mapWithTimestamps(item.replies) : undefined
    }));

    // Bump this version whenever initialPosts is replaced so cached data is evicted
    const POSTS_SEED_VERSION = '3';
    const storedVersion = localStorage.getItem('meetifyy_posts_seed_v');
    if (storedVersion !== POSTS_SEED_VERSION) {
      localStorage.removeItem('meetifyy_posts');
      localStorage.setItem('meetifyy_posts_seed_v', POSTS_SEED_VERSION);
    }

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
    const COMMUNITIES_SEED_VERSION = '2';
    const storedVersion = localStorage.getItem('meetifyy_communities_seed_v');
    if (storedVersion !== COMMUNITIES_SEED_VERSION) {
      localStorage.removeItem('meetifyy_communities');
      localStorage.setItem('meetifyy_communities_seed_v', COMMUNITIES_SEED_VERSION);
    }

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

  const [campusGroupsState, setCampusGroupsState] = useState(() => {
    const saved = localStorage.getItem('meetifyy_campus_groups');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error(e);
      }
    }
    return {};
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

  const [savedPosts, setSavedPosts] = useState(() => {
    try {
      const saved = localStorage.getItem('meetifyy_saved_posts');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  const [reportedPosts, setReportedPosts] = useState(() => {
    try {
      const saved = localStorage.getItem('meetifyy_reported_posts');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  // Persist states to localStorage when changed
  useEffect(() => {
    localStorage.setItem('meetifyy_users', JSON.stringify(users));
  }, [users]);

  useEffect(() => {
    try {
      // Strip base64 data-URL media before persisting — they can be tens of MBs
      // and will silently blow the localStorage 5 MB quota.
      // External https:// URLs are kept as-is.
      const serializable = posts.map(p => {
        if (!p.media) return p;
        const url = typeof p.media === 'string' ? p.media : p.media?.url;
        if (url && url.startsWith('data:')) {
          // Drop the blob — it only lives in this session anyway
          return { ...p, media: null };
        }
        return p;
      });
      localStorage.setItem('meetifyy_posts', JSON.stringify(serializable));
    } catch (e) {
      // Quota exceeded — not fatal, posts still work in-memory this session
      console.warn('Could not persist posts to localStorage:', e);
    }
  }, [posts]);

  useEffect(() => {
    localStorage.setItem('meetifyy_communities', JSON.stringify(communitiesState));
  }, [communitiesState]);

  useEffect(() => {
    localStorage.setItem('meetifyy_campus_groups', JSON.stringify(campusGroupsState));
  }, [campusGroupsState]);

  useEffect(() => {
    try {
      const serializable = conversations.map(c => {
        if (!c.messages) return c;
        const cleanedMsgs = c.messages.map(m => {
          if (m.mediaUrl && (m.mediaUrl.startsWith('data:') || m.mediaUrl.startsWith('blob:'))) {
            return { ...m, mediaUrl: null };
          }
          return m;
        });
        return { ...c, messages: cleanedMsgs };
      });
      localStorage.setItem('meetifyy_conversations', JSON.stringify(serializable));
    } catch (e) {
      console.warn('Could not persist conversations to localStorage:', e);
    }
  }, [conversations]);

  useEffect(() => {
    localStorage.setItem('meetifyy_crew_activities', JSON.stringify(crewActivities));
  }, [crewActivities]);

  useEffect(() => {
    localStorage.setItem('meetifyy_saved_activities', JSON.stringify(savedActivities));
  }, [savedActivities]);

  useEffect(() => {
    localStorage.setItem('meetifyy_reported_posts', JSON.stringify(reportedPosts));
  }, [reportedPosts]);

  useEffect(() => {
    localStorage.setItem('meetifyy_saved_posts', JSON.stringify(savedPosts));
  }, [savedPosts]);

  // Real-time current user presence tracking & multi-tab coordination
  useEffect(() => {
    if (!currentUser || !currentUser.username) return;

    const username = currentUser.username;
    let idleTimer = null;
    let saveDebounceTimer = null;
    const IDLE_TIMEOUT = 5 * 60 * 1000; // 5 minutes

    const broadcastChannel = typeof BroadcastChannel !== 'undefined' 
      ? new BroadcastChannel('meetify_presence_channel') 
      : null;

    const tabId = Math.random().toString(36).substring(2, 11);
    const activeTabs = new Set([tabId]);

    const setOnline = (online, forceWrite = false) => {
      setUsers(prev => {
        const u = prev[username];
        if (!u) return prev;
        if (u.isOnline === online && !forceWrite) return prev;

        const updatedUser = {
          ...u,
          isOnline: online,
          lastActive: Date.now()
        };

        if (broadcastChannel) {
          broadcastChannel.postMessage({
            type: 'PRESENCE_CHANGE',
            username,
            isOnline: online,
            lastActive: updatedUser.lastActive,
            tabId
          });
        }

        return {
          ...prev,
          [username]: updatedUser
        };
      });
    };

    const handleUserActivity = () => {
      setOnline(true);

      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        setOnline(false);
      }, IDLE_TIMEOUT);

      if (!saveDebounceTimer) {
        saveDebounceTimer = setTimeout(() => {
          setOnline(true, true);
          saveDebounceTimer = null;
        }, 60 * 1000);
      }
    };

    setOnline(true);
    handleUserActivity();

    const activityEvents = ['mousemove', 'mousedown', 'keypress', 'scroll', 'touchstart'];
    const onActivity = () => handleUserActivity();

    activityEvents.forEach(evt => {
      window.addEventListener(evt, onActivity);
    });

    const handleNetworkOnline = () => setOnline(true);
    const handleNetworkOffline = () => setOnline(false);
    window.addEventListener('online', handleNetworkOnline);
    window.addEventListener('offline', handleNetworkOffline);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        setOnline(true);
        handleUserActivity();
      } else {
        if (broadcastChannel) {
          broadcastChannel.postMessage({ type: 'TAB_HIDDEN', tabId });
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    if (broadcastChannel) {
      broadcastChannel.postMessage({ type: 'TAB_PING', tabId });

      broadcastChannel.onmessage = (event) => {
        const msg = event.data;
        if (!msg) return;

        if (msg.type === 'TAB_PING') {
          broadcastChannel.postMessage({ type: 'TAB_PONG', tabId: msg.tabId, senderTabId: tabId });
        } else if (msg.type === 'TAB_PONG' && msg.tabId === tabId) {
          activeTabs.add(msg.senderTabId);
        } else if (msg.type === 'PRESENCE_CHANGE') {
          if (msg.username !== username) {
            setUsers(prev => {
              const u = prev[msg.username];
              if (!u) return prev;
              if (u.isOnline === msg.isOnline && u.lastActive === msg.lastActive) return prev;
              return {
                ...prev,
                [msg.username]: {
                  ...u,
                  isOnline: msg.isOnline,
                  lastActive: msg.lastActive
                }
              };
            });
          }
        } else if (msg.type === 'TAB_HIDDEN') {
          activeTabs.delete(msg.tabId);
          if (activeTabs.size === 0 && document.visibilityState !== 'visible') {
            setOnline(false);
          }
        } else if (msg.type === 'PROFILE_UPDATED' && msg.username !== username) {
          setUsers(prev => ({
            ...prev,
            [msg.username]: msg.user
          }));
        }
      };
    }

    return () => {
      if (idleTimer) clearTimeout(idleTimer);
      if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
      
      activityEvents.forEach(evt => {
        window.removeEventListener(evt, onActivity);
      });
      window.removeEventListener('online', handleNetworkOnline);
      window.removeEventListener('offline', handleNetworkOffline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);

      if (broadcastChannel) {
        broadcastChannel.postMessage({ type: 'TAB_HIDDEN', tabId });
        broadcastChannel.close();
      }
    };
  }, [currentUser]);

  // Simulation of other users' presence toggles to simulate real-time updates
  useEffect(() => {
    if (!currentUser) return;

    const interval = setInterval(() => {
      setUsers(prev => {
        const usernames = Object.keys(prev).filter(name => name !== currentUser.username);
        if (usernames.length === 0) return prev;

        const randomName = usernames[Math.floor(Math.random() * usernames.length)];
        const user = prev[randomName];
        if (!user) return prev;

        const showOnline = user.preferences?.showOnlineStatus ?? true;
        if (!showOnline) return prev;

        const nextOnline = !user.isOnline;
        const updated = {
          ...user,
          isOnline: nextOnline,
          lastActive: nextOnline ? Date.now() : Date.now() - Math.floor(Math.random() * 30 * 60 * 1000)
        };

        return {
          ...prev,
          [randomName]: updated
        };
      });
    }, 45000);

    return () => clearInterval(interval);
  }, [currentUser]);



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
          const actChatId = String(act.id).startsWith('act_') ? String(act.id) : `act_${act.id}`;
          const existing = newConvs.find(c => c.id === actChatId);
          
          if (!existing) {
            newConvs.unshift({
              id: actChatId,
              name: act.title,
              avatar: act.coverImage || '',
              description: act.description || '',
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
            const updated = {
              ...existing,
              ...currentUser
            };
            const broadcastChannel = typeof BroadcastChannel !== 'undefined' 
              ? new BroadcastChannel('meetify_presence_channel') 
              : null;
            if (broadcastChannel) {
              broadcastChannel.postMessage({
                type: 'PROFILE_UPDATED',
                username: currentUser.username,
                user: updated
              });
              broadcastChannel.close();
            }
            return {
              ...prev,
              [currentUser.username]: updated
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
    const userCommunities = users[currentUser?.username]?.communities || currentUser?.communities || [];
    const isJoined = userCommunities.includes(comm.name);
    return {
      ...comm,
      joined: isJoined,
      get growth() { return comm.newMembersThisWeek > 0 ? `+${comm.newMembersThisWeek} this week` : ''; }
    };
  }, [currentUser, users]);

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

  const addPost = useCallback(async (text, poll, communityId = null, media = null, mentions = []) => {
    await new Promise(resolve => setTimeout(resolve, 600));

    const validMentions = (Array.isArray(mentions) ? mentions : []).filter(m => 
      m && typeof m.start === 'number' && typeof m.end === 'number' && m.username
    );

    const newPost = {
      id: `post_${Date.now()}`,
      authorId: currentUser.id,
      createdAt: Date.now(),
      time: 'just now',
      text,
      media,
      mentions: validMentions,
      poll: poll ? {
        ...poll,
        votes: poll.options.map(() => 0),
        selectedUsers: {}
      } : undefined,
      linkPreview: getLinkPreview(text) || undefined,
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

    const uniqueUsers = new Set();
    validMentions.forEach(m => {
      if (m.username && m.username !== currentUser.username) {
        uniqueUsers.add(m.username);
      }
    });
    uniqueUsers.forEach(uname => {
      notify('mention', { actorId: currentUser.id, targetUsername: uname, text: 'mentioned you in a post.', postId: newPost.id, subType: 'post' });
    });
  }, [currentUser, users, notify]);

  const deletePost = useCallback(async (postId) => {
    await new Promise(resolve => setTimeout(resolve, 400));
    setPosts(prev => prev.filter(p => p.id !== postId));
  }, []);

  const editPost = useCallback(async (postId, newText, mentions = []) => {
    await new Promise(resolve => setTimeout(resolve, 300));
    const validMentions = (Array.isArray(mentions) ? mentions : []).filter(m => 
      m && typeof m.start === 'number' && typeof m.end === 'number' && m.username
    );
    setPosts(prev => prev.map(p => {
      if (p.id === postId) {
        return { 
          ...p, 
          text: newText, 
          mentions: validMentions,
          linkPreview: getLinkPreview(newText) || undefined
        };
      }
      return p;
    }));
  }, []);

  const addComment = useCallback(async (postId, text, parentCommentId = null, mentions = []) => {
    await new Promise(resolve => setTimeout(resolve, 600));
    const validMentions = (Array.isArray(mentions) ? mentions : []).filter(m => 
      m && typeof m.start === 'number' && typeof m.end === 'number' && m.username
    );
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
        mentions: validMentions,
        likedBy: [],
        likes: 0,
        isLikedByMe: false,
        replies: []
      };

      const uniqueUsers = new Set();
      validMentions.forEach(m => {
        if (m.username && m.username !== currentUser.username) {
          uniqueUsers.add(m.username);
        }
      });
      uniqueUsers.forEach(uname => {
        notify('mention', { actorId: currentUser.id, targetUsername: uname, text: 'mentioned you in a comment.', postId, subType: 'comment' });
      });

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

      // Count total nodes removed (comment + all its nested replies)
      let removedCount = 0;
      const countDescendants = (node) => {
        let n = 1; // the node itself
        (node.replies || []).forEach(r => { n += countDescendants(r); });
        return n;
      };

      const filterNode = (nodes) => {
        const filtered = nodes.filter(node => {
          if (node.id === commentId) {
            removedCount += countDescendants(node);
            return false;
          }
          return true;
        });
        return filtered.map(node => ({
          ...node,
          replies: node.replies && node.replies.length > 0 ? filterNode(node.replies) : node.replies
        }));
      };

      const newReplies = filterNode(p.replies || []);
      return {
        ...p,
        comments: Math.max(0, p.comments - removedCount),
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

      // Guard: ensure votes array always matches options length to avoid NaN
      const baseVotes = Array.from({ length: p.poll.options.length }, (_, i) => {
        const v = (p.poll.votes || [])[i];
        return (typeof v === 'number' && !isNaN(v)) ? v : 0;
      });
      optionIndices.forEach(idx => {
        if (idx >= 0 && idx < baseVotes.length) baseVotes[idx] += 1;
      });

      return {
        ...p,
        poll: {
          ...p.poll,
          votes: baseVotes,
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
      coverImage: defaultCover,
      createdAt: Date.now(),
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
    
    setUsers(prevUsers => {
      const user = prevUsers[currentUser.username] || currentUser;
      return {
        ...prevUsers,
        [currentUser.username]: {
          ...user,
          communities: [...(user.communities || []), newComm.name]
        }
      };
    });

    // Auto join the community
    updateCurrentUser({
      ...currentUser,
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

      const kickedMember = (comm.memberList || []).find(m => m.id === userIdToKick);
      const newMemberList = (comm.memberList || []).filter(m => m.id !== userIdToKick);
      // Also remove their avatar from the avatar strip
      const newMemberAvatars = kickedMember
        ? (comm.memberAvatars || []).filter(a => a !== kickedMember.avatar)
        : (comm.memberAvatars || []);
      const newBannedUsers = {
        ...(comm.bannedUsers || {}),
        [userIdToKick]: Date.now() + 7 * 24 * 60 * 60 * 1000 // 7 days from now
      };

      return {
        ...prev,
        [communityId]: {
          ...comm,
          memberList: newMemberList,
          memberAvatars: newMemberAvatars,
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

  const sendDirectMessage = useCallback(async (convId, text, replyTo = null, inviteData = null, mentions = [], mediaUrl = null, mediaType = null, explicitLinkPreview = null) => {
    const now = new Date();
    let hours = now.getHours();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    const timeStr = hours + ':' + (now.getMinutes() < 10 ? '0' : '') + now.getMinutes() + ' ' + ampm;
    const tempId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 11);

    const validMentions = (Array.isArray(mentions) ? mentions : []).filter(m => 
      m && typeof m.start === 'number' && typeof m.end === 'number' && m.username
    );

    const newMessage = { 
      id: tempId,
      from: 'me', 
      text, 
      time: timeStr,
      timestamp: now.getTime(),
      status: 'sending',
      replyTo: replyTo ? { text: replyTo.text, from: replyTo.from } : null,
      inviteData: inviteData || null,
      mentions: validMentions,
      mediaUrl: mediaUrl || null,
      mediaType: mediaType || null,
      linkPreview: explicitLinkPreview || (text ? (getLinkPreview(text) || undefined) : undefined)
    };

    setConversations((prev) => {
      const convIndex = prev.findIndex(c => c.id === convId);
      if (convIndex === -1) return prev;
      
      const conv = prev[convIndex];
      const updatedConv = {
        ...conv,
        messages: [...conv.messages, newMessage],
        lastMsg: mediaUrl ? (mediaType === 'video' ? '📹 Video' : '🖼 Image') : text,
        time: 'now',
        timestamp: Date.now()
      };
      
      const newConvs = [...prev];
      newConvs.splice(convIndex, 1);
      newConvs.unshift(updatedConv); // Move to top
      return newConvs;
    });

    // Simulated network delay of 1000ms
    setTimeout(() => {
      // 15% chance to simulate a sending failure
      const isFailed = Math.random() < 0.15;

      setConversations((prev) => {
        const convIndex = prev.findIndex(c => c.id === convId);
        if (convIndex === -1) return prev;
        
        const conv = prev[convIndex];
        const targetUser = Object.values(users).find(u => u.username === conv.username || u.id === conv.userId);
        const isOnline = targetUser ? !!targetUser.isOnline : false;
        const successStatus = isOnline ? 'delivered' : 'sent';

        const updatedMessages = conv.messages.map((m) => {
          if (m.id === tempId) {
            return {
              ...m,
              status: isFailed ? 'failed' : successStatus
            };
          }
          return m;
        });

        // Trigger read receipt transition if online, not failed, and settings allow
        if (!isFailed && isOnline) {
          const meUser = users[currentUser?.username];
          const bothHaveReadReceipts = 
            (meUser?.preferences?.readReceipts !== false && meUser?.settings?.privacy?.readReceipts !== false) &&
            (targetUser?.preferences?.readReceipts !== false && targetUser?.settings?.privacy?.readReceipts !== false);

          if (bothHaveReadReceipts) {
            setTimeout(() => {
              setConversations(current => current.map(c => {
                if (c.id !== convId) return c;
                const msgs = c.messages.map((m) => {
                  if (m.id === tempId && m.status !== 'read') {
                    return { ...m, status: 'read' };
                  }
                  return m;
                });
                return { ...c, messages: msgs };
              }));
            }, 2000);
          }
        }

        // Notify mentioned users ONLY if this is a group and they are in the group
        if (!isFailed) {
          const participants = conv.participants || [];
          const isGroup = conv.isGroup || participants.length > 2 || (conv.name && conv.name.includes('Group'));
          if (isGroup) {
            const uniqueUsers = new Set();
            validMentions.forEach(m => {
              if (m.username && m.username !== currentUser?.username) {
                if (participants.some(p => (typeof p === 'string' ? p : p.username) === m.username)) {
                  uniqueUsers.add(m.username);
                }
              }
            });
            uniqueUsers.forEach(uname => {
              notify('mention', { actorId: currentUser?.id, targetUsername: uname, text: 'mentioned you in a group chat.', convId, subType: 'chat' });
            });
          }
        }

        const updatedConv = {
          ...conv,
          messages: updatedMessages
        };

        const newConvs = [...prev];
        newConvs.splice(convIndex, 1);
        newConvs.unshift(updatedConv);
        return newConvs;
      });
    }, 1000);
  }, [currentUser, notify, users]);

  const retryDirectMessage = useCallback(async (convId, msgId) => {
    setConversations((prev) => {
      const convIndex = prev.findIndex(c => c.id === convId);
      if (convIndex === -1) return prev;
      
      const conv = prev[convIndex];
      const updatedMessages = conv.messages.map((m) => {
        if (m.id === msgId) {
          return { ...m, status: 'sending' };
        }
        return m;
      });

      const updatedConv = { ...conv, messages: updatedMessages };
      const newConvs = [...prev];
      newConvs.splice(convIndex, 1);
      newConvs.unshift(updatedConv);
      return newConvs;
    });

    setTimeout(() => {
      setConversations((prev) => {
        const convIndex = prev.findIndex(c => c.id === convId);
        if (convIndex === -1) return prev;
        
        const conv = prev[convIndex];
        const targetUser = Object.values(users).find(u => u.username === conv.username || u.id === conv.userId);
        const isOnline = targetUser ? !!targetUser.isOnline : false;
        const successStatus = isOnline ? 'delivered' : 'sent';

        const updatedMessages = conv.messages.map((m) => {
          if (m.id === msgId) {
            return { ...m, status: successStatus };
          }
          return m;
        });

        if (isOnline) {
          const meUser = users[currentUser?.username];
          const bothHaveReadReceipts = 
            (meUser?.preferences?.readReceipts !== false && meUser?.settings?.privacy?.readReceipts !== false) &&
            (targetUser?.preferences?.readReceipts !== false && targetUser?.settings?.privacy?.readReceipts !== false);

          if (bothHaveReadReceipts) {
            setTimeout(() => {
              setConversations(current => current.map(c => {
                if (c.id !== convId) return c;
                const msgs = c.messages.map((m) => {
                  if (m.id === msgId && m.status !== 'read') {
                    return { ...m, status: 'read' };
                  }
                  return m;
                });
                return { ...c, messages: msgs };
              }));
            }, 2000);
          }
        }

        const updatedConv = { ...conv, messages: updatedMessages };
        const newConvs = [...prev];
        newConvs.splice(convIndex, 1);
        newConvs.unshift(updatedConv);
        return newConvs;
      });
    }, 1000);
  }, [currentUser, users]);

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

  const togglePinConversation = useCallback((convId) => {
    setConversations(prev => prev.map(c => 
      c.id === convId ? { ...c, pinned: !c.pinned } : c
    ));
  }, []);

  const toggleMuteConversation = useCallback((convId) => {
    setConversations(prev => prev.map(c => 
      c.id === convId ? { ...c, muted: !c.muted } : c
    ));
  }, []);

  const markConversationUnread = useCallback((convId, status = true) => {
    setConversations(prev => prev.map(c => 
      c.id === convId ? { ...c, unread: status ? 1 : 0 } : c
    ));
  }, []);

  const deleteConversation = useCallback((convId) => {
    setConversations(prev => prev.filter(c => c.id !== convId));
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
      const activityChatId = String(activityId).startsWith('act_') ? String(activityId) : `act_${activityId}`;
      const existingConv = prev.find(c => c.id === activityChatId);
      
      if (existingConv) {
        // Add user to participants if not already and inject system message
        if (!existingConv.participants?.includes(currentUser?.id)) {
          const sysMsg = { id: Date.now(), type: 'system', text: `@${currentUser?.username || 'someone'} has joined`, time: 'Just now' };
          return prev.map(c => c.id === activityChatId ? {
            ...c,
            participants: [...(c.participants || []), currentUser?.id],
            messages: [...(c.messages || []), sysMsg],
            lastMsg: `@${currentUser?.username || 'someone'} has joined`,
            time: 'Just now',
            timestamp: Date.now()
          } : c);
        }
        return prev;
      } else {
        // Read title from crewActivities via setCrewActivities prev — avoid stale closure
        // by searching within the conversations prev list for a name hint, or using activityId
        const sysMsg = { id: Date.now(), type: 'system', text: `@${currentUser?.username || 'someone'} has joined`, time: 'Just now' };
        const newConv = {
          id: activityChatId,
          name: `Activity Chat (${activityId})`, // will be enriched by enrichedConversations memo
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

  }, [currentUser, notify]);

  const leaveCrewActivity = useCallback(async (activityId) => {
    await new Promise(resolve => setTimeout(resolve, 400));
    setCrewActivities(prev => prev.map(a => {
      if (a.id !== activityId) return a;
      const isJoined = a.participants?.includes(currentUser?.id);
      if (!isJoined) return a;

      return {
        ...a,
        slotsFilled: Math.max(0, (a.slotsFilled || 1) - 1),
        participants: (a.participants || []).filter(uid => uid !== currentUser?.id)
      };
    }));

    setConversations(prev => {
      const activityChatId = String(activityId).startsWith('act_') ? String(activityId) : `act_${activityId}`;
      const existingConv = prev.find(c => c.id === activityChatId);
      
      if (existingConv) {
        if (existingConv.participants?.includes(currentUser?.id)) {
          const sysMsg = { id: Date.now(), type: 'system', text: `@${currentUser?.username || 'someone'} has left`, time: 'Just now' };
          return prev.map(c => c.id === activityChatId ? {
            ...c,
            participants: (c.participants || []).filter(uid => uid !== currentUser?.id),
            messages: [...(c.messages || []), sysMsg],
            lastMsg: `@${currentUser?.username || 'someone'} has left`,
            time: 'Just now',
            timestamp: Date.now()
          } : c);
        }
      }
      return prev;
    });
  }, [currentUser]);

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
    const activityChatId = String(activityId).startsWith('act_') ? String(activityId) : `act_${activityId}`;
    setConversations(prev => {
      const existing = prev.find(c => c.id === activityChatId);
      if (existing) {
        const requester = Object.values(users).find(u => u.id === requesterId);
        const reqName = requester ? requester.username : 'someone';
        const sysMsg = { id: Date.now(), type: 'system', text: `@${reqName} has joined`, time: 'Just now' };
        
        return prev.map(c => c.id === activityChatId ? {
          ...c,
          participants: [...(c.participants || []), requesterId],
          messages: [...(c.messages || []), sysMsg],
          lastMsg: `@${reqName} has joined`,
          time: 'Just now',
          timestamp: Date.now()
        } : c);
      }
      return prev; // If it doesn't exist, we don't worry about it here
    });

  }, [users]);

  const rejectJoinRequest = useCallback((activityId, requesterId) => {
    setCrewActivities(prev => prev.map(a => {
      if (a.id === activityId) {
        return {
          ...a,
          pendingRequests: (a.pendingRequests || []).filter(id => id !== requesterId)
        };
      }
      return a;
    }));
  }, []);

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

      // Simulation: Mock host accepts the current user's request after 6 seconds
      setTimeout(() => {
        acceptJoinRequest(activityId, currentUser?.id);
        
        // Notify current user about approval
        notify('crew_join', {
          activityId,
          actorId: activity.hostId,
          targetUsername: currentUser?.username,
          text: `accepted your request to join "${activity.title}".`,
        });
      }, 6000);
    }
  }, [currentUser, notify, crewActivities, acceptJoinRequest]);

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

    // Create a group chat for this activity only if requested
    if (newActivity.createEventGroup) {
      const activityChatId = String(newActivity.id).startsWith('act_') ? String(newActivity.id) : `act_${newActivity.id}`;
      const newConv = {
        id: activityChatId,
        name: newActivity.title,
        isGroup: true,
        editGroupPermission: 'Everyone',
        isActivityChat: true,
        activityId: newActivity.id,
        ownerId: currentUser?.id || newActivity.hostId || 'current_user',
        admins: [],
        members: [currentUser?.id || newActivity.hostId || 'current_user'],
        participants: [currentUser?.id || newActivity.hostId || 'current_user'],
        avatar: newActivity.coverImage || null,
        color: 'var(--color-primary)',
        online: true,
        lastMsg: 'Group chat created!',
        time: 'Just now',
        unread: 0,
        messages: [],
        createdAt: Date.now()
      };
      setConversations(prev => [newConv, ...prev]);
    }

    // Simulation: If created activity is approval-based, mock a join request from another user after 5 seconds
    if (newActivity.participationType === 'approval') {
      setTimeout(() => {
        const mockUsersList = Object.values(users).filter(u => u.id !== currentUser?.id);
        const randomUser = mockUsersList[Math.floor(Math.random() * mockUsersList.length)];
        if (randomUser) {
          // Add to pendingRequests
          setCrewActivities(prev => prev.map(a => {
            if (a.id === newActivity.id) {
              return {
                ...a,
                pendingRequests: [...(a.pendingRequests || []), randomUser.id]
              };
            }
            return a;
          }));

          // Notify the host (current user)
          notify('ACTIVITY_JOIN_REQUEST', {
            activityId: newActivity.id,
            actorId: randomUser.id,
            targetUsername: currentUser?.username,
            text: `requested to join your activity "${newActivity.title}".`,
          });
        }
      }, 5000);
    } else if (newActivity.participationType === 'open') {
      // Simulation: If created activity is open, a mock user joins directly after 5 seconds
      setTimeout(() => {
        const mockUsersList = Object.values(users).filter(u => u.id !== currentUser?.id);
        const randomUser = mockUsersList[Math.floor(Math.random() * mockUsersList.length)];
        if (randomUser) {
          // Add to participants & increase slotsFilled
          setCrewActivities(prev => prev.map(a => {
            if (a.id === newActivity.id) {
              return {
                ...a,
                slotsFilled: Math.min(a.slotsFilled + 1, a.slotsNeeded),
                participants: [...(a.participants || []), randomUser.id]
              };
            }
            return a;
          }));

          // Notify the host (current user)
          notify('crew_join', {
            activityId: newActivity.id,
            actorId: randomUser.id,
            targetUsername: currentUser?.username,
            text: `joined your activity "${newActivity.title}".`,
          });

          // Add to group chat and send system message
          const activityChatId = String(newActivity.id).startsWith('act_') ? String(newActivity.id) : `act_${newActivity.id}`;
          setConversations(prev => {
            const existing = prev.find(c => c.id === activityChatId);
            if (existing) {
              const sysMsg = { id: Date.now(), type: 'system', text: `@${randomUser.username} has joined`, time: 'Just now' };
              return prev.map(c => c.id === activityChatId ? {
                ...c,
                participants: [...(c.participants || []), randomUser.id],
                messages: [...(c.messages || []), sysMsg],
                lastMsg: `@${randomUser.username} has joined`,
                time: 'Just now',
                timestamp: Date.now()
              } : c);
            }
            return prev;
          });
        }
      }, 5000);
    }
  }, [currentUser, users, notify]);

  const endCrewActivity = useCallback(async (activityId) => {
    await new Promise(resolve => setTimeout(resolve, 300));
    setCrewActivities(prev => prev.filter(a => a.id !== activityId));
    setSavedActivities(prev => prev.filter(id => id !== activityId));
  }, []);

  const createGroupConversation = useCallback(async (groupName, userIds) => {
    await new Promise(resolve => setTimeout(resolve, 300));
    
    const newId = 'g_' + Date.now();
    const newConv = {
      id: newId,
      name: groupName,
      isGroup: true,
      editGroupPermission: 'Everyone',
      whoCanJoin: 'Anyone',
      visibility: 'Hidden group',
      allowSharing: true,
      ownerId: currentUser?.id,
      admins: [],
      members: [currentUser?.id],
      avatar: null,
      color: '#2d2d2d',
      online: true,
      lastMsg: 'Group created',
      time: 'Just now',
      unread: 0,
      description: '',
      createdAt: Date.now(),
      messages: [],
    };
    setConversations(prev => [newConv, ...prev]);

    // Send a DM invite to all selected users so they can join
    for (const uid of userIds) {
      const u = Object.values(users).find(usr => usr.id === uid);
      if (u) {
        const dmConvId = await startConversation(u);
        sendDirectMessage(dmConvId, `You've been invited to join the group "${groupName}".`, null, {
          groupId: newId,
          groupName: groupName
        });
      }
    }

    return newId;
  }, [currentUser, users, startConversation, sendDirectMessage]);

  const createTemporaryGroupChat = useCallback(async (activityName, userIds) => {
    await new Promise(resolve => setTimeout(resolve, 300));
    
    const newId = 't_' + Date.now();
    const newConv = {
      id: newId,
      name: activityName,
      isGroup: true,
      editGroupPermission: 'Everyone',
      isTemporary: true,
      expiresAt: Date.now() + 4 * 60 * 60 * 1000, // 4 hours from now
      ownerId: currentUser?.id,
      admins: [],
      members: [currentUser?.id, ...userIds],
      avatar: null,
      color: '#6366f1',
      online: true,
      lastMsg: 'Temporary room created',
      time: 'Just now',
      unread: 0,
      description: `Instant Match for ${activityName}`,
      createdAt: Date.now(),
      messages: [],
      visibility: 'Hidden group'
    };
    setConversations(prev => [newConv, ...prev]);
    return newId;
  }, [currentUser]);

  const createCampusGroup = useCallback(async (groupName, description, avatar) => {
    await new Promise(resolve => setTimeout(resolve, 300));
    const id = 'c_' + Date.now();
    const collegeName = currentUser?.collegeId === 'gla' 
      ? 'GLA University' 
      : currentUser?.collegeId === 'iitdelhi' 
        ? 'IIT Delhi' 
        : 'University';
    
    const newComm = {
      id,
      name: groupName,
      desc: description,
      avatar: avatar || null,
      members: 1,
      isUniversity: false,
      collegeId: currentUser?.collegeId || 'gla',
      categories: ['general'],
      whoCanJoin: 'Anyone',
      visibility: `Visible only to ${collegeName}`,
      allowSharing: true,
      memberList: [{
        id: currentUser?.id,
        name: currentUser?.displayName || currentUser?.username || 'You',
        avatar: currentUser?.avatar,
        role: 'Creator',
        admin: true
      }],
      bannedUsers: {}
    };

    setCampusGroupsState(prev => ({ ...prev, [id]: newComm }));

    const newConv = {
      id: id,
      name: groupName,
      isGroup: true,
      editGroupPermission: 'Everyone',
      whoCanJoin: 'Anyone',
      visibility: `Visible only to ${collegeName}`,
      allowSharing: true,
      ownerId: currentUser?.id,
      admins: [],
      members: [currentUser?.id],
      avatar: avatar || null,
      color: '#2d2d2d',
      online: true,
      lastMsg: 'Group created',
      time: 'Just now',
      unread: 0,
      description: description,
      createdAt: Date.now(),
      messages: [],
    };

    setConversations(prev => [newConv, ...prev]);

    updateCurrentUser({
      ...currentUser,
      campusGroups: [...(currentUser?.campusGroups || []), id]
    });

    return id;
  }, [currentUser, updateCurrentUser]);

  const updateGroupInfo = useCallback(async (convId, newName, newAvatar, newDescription) => {
    setConversations(prev => prev.map(c => 
      c.id === convId ? { 
        ...c, 
        name: newName !== undefined ? newName : c.name, 
        avatar: newAvatar !== undefined ? newAvatar : c.avatar,
        description: newDescription !== undefined ? newDescription : c.description
      } : c
    ));

    setCommunitiesState(prev => {
      const comm = prev[convId];
      if (!comm) return prev;
      return {
        ...prev,
        [convId]: {
          ...comm,
          name: newName !== undefined ? newName : comm.name,
          avatar: newAvatar !== undefined ? newAvatar : comm.avatar,
          desc: newDescription !== undefined ? newDescription : comm.desc
        }
      };
    });

    setCampusGroupsState(prev => {
      const group = prev[convId];
      if (!group) return prev;
      return {
        ...prev,
        [convId]: {
          ...group,
          name: newName !== undefined ? newName : group.name,
          avatar: newAvatar !== undefined ? newAvatar : group.avatar,
          desc: newDescription !== undefined ? newDescription : group.desc
        }
      };
    });
  }, []);

  const updateGroupEditPermission = useCallback(async (convId, newPermission) => {
    setConversations(prev => prev.map(c => 
      c.id === convId ? { ...c, editGroupPermission: newPermission } : c
    ));
    setCampusGroupsState(prev => {
      const group = prev[convId];
      if (!group) return prev;
      return {
        ...prev,
        [convId]: {
          ...group,
          editGroupPermission: newPermission
        }
      };
    });
  }, []);

  const changeGroupOwner = useCallback(async (convId, newOwnerId) => {
    const newOwnerUser = Object.values(users).find(u => u.id === newOwnerId) || users[newOwnerId];
    const newOwnerName = newOwnerUser?.username ? `@${newOwnerUser.username}` : (newOwnerUser?.name ? `@${newOwnerUser.name}` : 'someone');
    const oldOwnerName = currentUser?.username ? `@${currentUser.username}` : (currentUser?.name ? `@${currentUser.name}` : 'someone');
    const sysMsg = { id: Date.now(), type: 'system', text: `${oldOwnerName} changed the group owner to ${newOwnerName}.`, time: 'Just now' };

    setConversations(prev => prev.map(c => {
      if (c.id === convId) {
        // When transferring ownership, the new owner should probably not be in the admins array anymore
        let newAdmins = (c.admins || []).filter(id => id !== newOwnerId);
        // The old owner becomes an admin automatically
        if (c.ownerId && !newAdmins.includes(c.ownerId)) {
          newAdmins.push(c.ownerId);
        }
        return { 
          ...c, 
          ownerId: newOwnerId, 
          admins: newAdmins,
          messages: [...(c.messages || []), sysMsg],
          lastMsg: sysMsg.text,
          time: 'Just now',
          timestamp: Date.now()
        };
      }
      return c;
    }));
    
    setCommunitiesState(prev => {
      const comm = prev[convId];
      if (!comm) return prev;
      return { ...prev, [convId]: { ...comm, ownerId: newOwnerId } };
    });
  }, [users, currentUser]);

  const promoteToAdmin = useCallback(async (convId, userId) => {
    const targetUser = Object.values(users).find(u => u.id === userId) || users[userId];
    const targetName = targetUser ? targetUser.username : 'someone';
    const actorName = currentUser?.username || 'admin';
    const sysMsg = { id: Date.now(), type: 'system', text: `@${targetName} was promoted to Admin by @${actorName}`, time: 'Just now' };

    setConversations(prev => prev.map(c => {
      if (c.id === convId) {
        return { 
          ...c, 
          admins: c.admins ? [...c.admins, userId] : [userId],
          messages: [...(c.messages || []), sysMsg],
          lastMsg: sysMsg.text,
          time: 'Just now',
          timestamp: Date.now()
        };
      }
      return c;
    }));
  }, [users, currentUser]);

  const demoteFromAdmin = useCallback(async (convId, userId) => {
    const targetUser = Object.values(users).find(u => u.id === userId) || users[userId];
    const targetName = targetUser ? targetUser.username : 'someone';
    const actorName = currentUser?.username || 'admin';
    const sysMsg = { id: Date.now(), type: 'system', text: `@${targetName} was removed from Admin by @${actorName}`, time: 'Just now' };

    setConversations(prev => prev.map(c => {
      if (c.id === convId) {
        return { 
          ...c, 
          admins: c.admins ? c.admins.filter(id => id !== userId) : [],
          messages: [...(c.messages || []), sysMsg],
          lastMsg: sysMsg.text,
          time: 'Just now',
          timestamp: Date.now()
        };
      }
      return c;
    }));
  }, [users, currentUser]);

  const addGroupMember = useCallback(async (convId, userId) => {
    const joinedUser = Object.values(users).find(u => u.id === userId) || users[userId];
    const joinedName = joinedUser ? joinedUser.username : 'someone';
    const sysMsg = { id: Date.now(), type: 'system', text: `@${joinedName} has joined`, time: 'Just now' };

    setConversations(prev => prev.map(c => {
      const isMember = c.members ? c.members.includes(userId) : (c.participants ? c.participants.includes(userId) : false);
      if (c.id === convId && !isMember) {
        return { 
          ...c, 
          members: c.members ? [...c.members, userId] : [userId],
          participants: c.participants ? [...c.participants, userId] : [userId],
          messages: [...(c.messages || []), sysMsg],
          lastMsg: `@${joinedName} has joined`,
          time: 'Just now',
          timestamp: Date.now()
        };
      }
      return c;
    }));
  }, [users]);

  const removeGroupMember = useCallback(async (convId, userId) => {
    const removedUser = Object.values(users).find(u => u.id === userId) || users[userId];
    const removedName = removedUser ? removedUser.username : 'someone';
    const removerName = currentUser?.username || 'admin';
    const sysMsg = { id: Date.now(), type: 'system', text: `@${removedName} was removed from the group`, time: 'Just now' };

    setConversations(prev => prev.map(c => {
      if (c.id === convId) {
        return { 
          ...c, 
          members: c.members ? c.members.filter(id => id !== userId) : c.members,
          participants: c.participants ? c.participants.filter(id => id !== userId) : c.participants,
          messages: [...(c.messages || []), sysMsg],
          lastMsg: `@${removedName} was removed from the group`,
          time: 'Just now',
          timestamp: Date.now()
        };
      }
      return c;
    }));
  }, [users, currentUser]);

  const leaveGroup = useCallback(async (convId) => {
    const leaverName = currentUser?.username || 'someone';
    const sysMsg = { id: Date.now(), type: 'system', text: `@${leaverName} has left`, time: 'Just now' };

    setConversations(prev => prev.map(c => {
      if (c.id === convId) {
        // Prevent owner from leaving
        if (c.ownerId === currentUser?.id) {
          console.warn("Owner cannot leave the group. Transfer ownership or end the group instead.");
          return c;
        }

        return { 
          ...c, 
          members: c.members ? c.members.filter(id => id !== currentUser?.id) : c.members,
          participants: c.participants ? c.participants.filter(id => id !== currentUser?.id) : c.participants,
          messages: [...(c.messages || []), sysMsg],
          lastMsg: `@${leaverName} has left`,
          time: 'Just now',
          timestamp: Date.now()
        };
      }
      return c;
    }));
  }, [currentUser]);

  const endGroup = useCallback(async (convId) => {
    const ownerName = currentUser?.name || currentUser?.username || 'Owner';
    const sysMsg = { id: Date.now(), type: 'system', text: `${ownerName} closed this group.`, time: 'Just now' };

    setConversations(prev => prev.map(c => {
      if (c.id === convId) {
        if (c.ownerId !== currentUser?.id) {
          console.warn("Only the Owner can end the group.");
          return c;
        }

        return { 
          ...c, 
          status: 'Closed',
          messages: [...(c.messages || []), sysMsg],
          lastMsg: `${ownerName} closed this group.`,
          time: 'Just now',
          timestamp: Date.now()
        };
      }
      return c;
    }));
  }, [currentUser]);

  const updateGroupSettings = useCallback(async (convId, settings) => {
    setConversations(prev => prev.map(c =>
      c.id === convId ? { ...c, ...settings } : c
    ));
    setCampusGroupsState(prev => {
      const group = prev[convId];
      if (!group) return prev;
      return {
        ...prev,
        [convId]: {
          ...group,
          ...settings
        }
      };
    });
  }, []);

  const initializeCampusGroupConversation = useCallback((groupId) => {
    if (!groupId) return;
    setConversations(prev => {
      const exists = prev.find(c => c.id === groupId);
      if (exists) return prev;

      const group = campusGroupsState[groupId];
      if (group) {
        const creatorId = group.memberList?.find(m => m.role === 'Creator')?.id || group.memberList?.[0]?.id || currentUser?.id;
        const newConv = {
          id: groupId,
          name: group.name,
          isGroup: true,
          editGroupPermission: 'Everyone',
          whoCanJoin: group.whoCanJoin || 'Anyone',
          visibility: group.visibility || 'Visible to Gla University',
          allowSharing: group.allowSharing !== false,
          ownerId: creatorId,
          admins: group.memberList?.filter(m => m.admin).map(m => m.id) || [],
          members: group.memberList?.map(m => m.id) || [],
          avatar: group.avatar || null,
          color: '#2d2d2d',
          online: true,
          lastMsg: 'Welcome to the group!',
          time: 'Just now',
          unread: 0,
          description: group.desc || '',
          createdAt: Date.now(),
          messages: [],
        };
        return [newConv, ...prev];
      }
      return prev;
    });
  }, [campusGroupsState, currentUser]);

  const toggleJoinCampusGroup = useCallback((groupId) => {
    if (!currentUser) return;
    const isJoined = currentUser.campusGroups?.map(String).includes(String(groupId));
    
    updateCurrentUser({
      ...currentUser,
      campusGroups: isJoined 
        ? currentUser.campusGroups.filter(id => String(id) !== String(groupId))
        : [...(currentUser.campusGroups || []), groupId]
    });

    setCampusGroupsState(prev => {
      const group = prev[groupId];
      if (!group) return prev;
      let newMemberList = [...(group.memberList || [])];
      let newMembersCount = group.members || 1;
      
      if (isJoined) {
        newMemberList = newMemberList.filter(m => String(m.id) !== String(currentUser.id));
        newMembersCount = Math.max(1, newMembersCount - 1);
      } else {
        if (!newMemberList.some(m => String(m.id) === String(currentUser.id))) {
          newMemberList.push({
            id: currentUser.id,
            name: currentUser.displayName || currentUser.username || 'You',
            avatar: currentUser.avatar,
            role: 'Member',
            admin: false
          });
          newMembersCount += 1;
        }
      }
      return {
        ...prev,
        [groupId]: {
          ...group,
          memberList: newMemberList,
          members: newMembersCount
        }
      };
    });

    setConversations(prev => {
      const existing = prev.find(c => c.id === groupId);
      const sysMsgText = isJoined 
        ? `@${currentUser.username || 'someone'} has left` 
        : `@${currentUser.username || 'someone'} has joined`;
      const sysMsg = { id: Date.now(), type: 'system', text: sysMsgText, time: 'Just now' };
      
      if (existing) {
        let newMembers = [...(existing.members || [])];
        if (isJoined) {
          newMembers = newMembers.filter(uid => String(uid) !== String(currentUser.id));
        } else {
          if (!newMembers.map(String).includes(String(currentUser.id))) {
            newMembers.push(currentUser.id);
          }
        }
        return prev.map(c => c.id === groupId ? {
          ...c,
          members: newMembers,
          messages: [...(c.messages || []), sysMsg],
          lastMsg: sysMsgText,
          time: 'Just now',
          timestamp: Date.now()
        } : c);
      } else if (!isJoined) {
        const group = campusGroupsState[groupId];
        if (group) {
          const creatorId = group.memberList?.find(m => m.role === 'Creator')?.id || group.memberList?.[0]?.id || currentUser.id;
          const newConv = {
            id: groupId,
            name: group.name,
            isGroup: true,
            editGroupPermission: 'Everyone',
            whoCanJoin: group.whoCanJoin || 'Anyone',
            visibility: group.visibility || 'Visible to Gla University',
            allowSharing: group.allowSharing !== false,
            ownerId: creatorId,
            admins: group.memberList?.filter(m => m.admin).map(m => m.id) || [],
            members: [...(group.memberList?.map(m => m.id) || []), currentUser.id],
            avatar: group.avatar || null,
            color: '#2d2d2d',
            online: true,
            lastMsg: sysMsgText,
            time: 'Just now',
            unread: 0,
            description: group.desc || '',
            createdAt: Date.now(),
            messages: [sysMsg],
          };
          return [newConv, ...prev];
        }
      }
      return prev;
    });
  }, [currentUser, updateCurrentUser, campusGroupsState]);

  const [searchQuery, setSearchQuery] = useState('');
  const liveCurrentUser = enrichUser(users[currentUser?.username] || currentUser);
  
  // Enrich all communities before providing them
  const enrichedCommunities = Object.keys(communitiesState).reduce((acc, key) => {
    acc[key] = enrichCommunity(communitiesState[key]);
    return acc;
  }, {});

  // Enrich conversations with latest user avatars/names and activity host logos
  const enrichedConversations = useMemo(() => {
    return conversations.map((conv, idx) => {
      let enriched = { ...conv };
      
      if (conv.isActivityChat) {
        const activity = crewActivities?.find(a => a.id === conv.activityId || `act_${a.id}` === conv.id || a.id === conv.id);
        if (activity) {
          enriched.activity = activity;
          if (!enriched.name && activity.title) {
            enriched.name = activity.title;
          }
          if (!enriched.avatar && activity.coverImage) {
            enriched.avatar = activity.coverImage;
          }
        }
        if (activity?.hostId) {
          const hostUser = Object.values(users).find(u => u.id === activity.hostId);
          if (hostUser) {
            if (!activity?.coverImage) {
              enriched.avatar = hostUser.avatarUrl || hostUser.avatar || conv.avatar;
            }
            enriched.hostUsername = hostUser.username;
          }
        }
      } else if (!conv.isGroup) {
        const targetUser = conv.username 
          ? users[conv.username] 
          : Object.values(users).find(u => u.displayName === conv.name || u.name === conv.name);
          
        if (targetUser) {
          enriched.name = targetUser.displayName || targetUser.name || conv.name;
          enriched.avatar = targetUser.avatarUrl || targetUser.avatar || conv.avatar;
          enriched.username = targetUser.username || conv.username;
          enriched.userId = targetUser.id || conv.userId;
          const canSee = canSeeOnlineStatus(currentUser, targetUser);
          enriched.online = canSee ? !!targetUser.isOnline : false;
        }
      }
      
      if (!enriched.timestamp) {
        enriched.timestamp = Date.now() - idx * 60000;
      }
      
      return enriched;
    });
  }, [conversations, users, crewActivities]);

  const toggleSaveActivity = useCallback((activityId) => {
    setSavedActivities(prev =>
      prev.includes(activityId)
        ? prev.filter(id => id !== activityId)
        : [...prev, activityId]
    );
  }, []);

  const toggleSavePost = useCallback((postId) => {
    setSavedPosts(prev =>
      prev.includes(postId)
        ? prev.filter(id => id !== postId)
        : [...prev, postId]
    );
  }, []);

  const reportPost = useCallback((postId) => {
    setReportedPosts(prev =>
      prev.includes(postId) ? prev : [...prev, postId]
    );
  }, []);

  // Reset all DataContext state on logout (so switching users starts fresh)
  const resetDataState = useCallback(() => {
    setUsers(() => {
      const initialized = { ...initialUsers };
      Object.keys(initialized).forEach(username => {
        const u = initialized[username];
        if (!u.followingList) u.followingList = [];
        if (!u.followersList) u.followersList = [];
      });
      return initialized;
    });
    setPosts(() => {
      const mapWithTimestamps = (items) => items.map(item => ({
        ...item,
        createdAt: item.createdAt || Date.now(),
        replies: item.replies ? mapWithTimestamps(item.replies) : undefined
      }));
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
    setCommunitiesState(initialCommunities);
    setConversations(initialMessages);
    setCrewActivities(generateCrewActivities(initialUsers));
    setSavedActivities([]);
    setReportedPosts([]);
    // Clear persisted data for all data keys
    ['meetifyy_users','meetifyy_posts','meetifyy_communities','meetifyy_conversations',
     'meetifyy_crew_activities','meetifyy_saved_activities','meetifyy_reported_posts',
     'meetifyy_notifications','meetifyy_campus_groups'].forEach(k => localStorage.removeItem(k));
  }, []);

  return (
    <DataContext.Provider value={{
      users,
      posts,
      communities: enrichedCommunities,
      campusGroups: campusGroupsState,
      conversations: enrichedConversations,
      crewActivities,
      savedActivities,
      toggleSaveActivity,
      savedPosts,
      toggleSavePost,
      reportedPosts,
      reportPost,
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
      toggleJoinCampusGroup,
      updateCommunity,
      kickMember,
      updateFollowerCount,
      toggleFollow,
      sendDirectMessage,
      retryDirectMessage,
      reactToMessage,
      clearChat,
      toggleBlockUser,
      togglePinConversation,
      toggleMuteConversation,
      markConversationUnread,
      deleteConversation,
      startConversation,
      createGroupConversation,
      createCampusGroup,
      updateGroupInfo,
      updateGroupEditPermission,
      changeGroupOwner,
      promoteToAdmin,
      demoteFromAdmin,
      addGroupMember,
      removeGroupMember,
      leaveGroup,
      endGroup,
      updateGroupSettings,
      initializeCampusGroupConversation,
      joinCrewActivity,
      leaveCrewActivity,
      requestToJoinActivity,
      acceptJoinRequest,
      rejectJoinRequest,
      declineCrewInvitation,
      addCrewActivity,
      endCrewActivity,
      createTemporaryGroupChat,
      resetDataState,
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
