import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useGlobalSocketStore } from '../stores/useGlobalSocketStore';
import { useAuth } from '../context/AuthContext';
import { useData } from '../hooks/useData';
import { PROFILE_KEYS } from './useProfile';
import { toggleRegistry } from '../utils/mutationRegistry';

import { flushPendingQueue } from '../../features/messages/shared/utils/offlineSync';
import { updateMessageInCache } from '../../features/messages/shared/utils/cacheUtils';

export function useGlobalSocketSync() {
  const queryClient = useQueryClient();
  const { socket, isConnected } = useGlobalSocketStore();
  const { currentUser } = useAuth();
  const { conversations } = useData() || {};
  const conversationsRef = useRef(conversations);

  // Keep ref in sync so the reconnect handler always sees the latest conversations
  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  // 1. Join Conversation Rooms & Flush Offline Queue on connect/reconnect
  useEffect(() => {
    if (!socket || !isConnected) return;

    const syncOnConnect = () => {
      const convs = conversationsRef.current;
      if (convs && convs.length > 0) {
        const conversationIds = [];
        convs.forEach((c) => {
          if (c.id) conversationIds.push(c.id);
          if (c.publicId && c.publicId !== c.id) conversationIds.push(c.publicId);
          if (c.internalId && c.internalId !== c.id && c.internalId !== c.publicId) {
            conversationIds.push(c.internalId);
          }
        });

        const unique = [...new Set(conversationIds.filter(Boolean))];
        if (unique.length > 0) {
          socket.emit('conversation:join_rooms', { conversationIds: unique });
        }
      }

      // Helper to cleanly unshift new messages into the cache without wiping older pages
      const unshiftMessageToCache = (convId, serverMsg) => {
        if (!convId || !serverMsg) return;
        queryClient.setQueryData(['messages', convId], (oldData) => {
          if (!oldData || !oldData.pages || oldData.pages.length === 0) return oldData;
          const newPages = [...oldData.pages];
          const firstPage = { ...newPages[0] };
          const msgs = firstPage.messages || [];
          
          // Only unshift if it doesn't already exist in the page
          const exists = msgs.some(m => String(m.id) === String(serverMsg.id) || (m.clientId && String(m.clientId) === String(serverMsg.clientId)));
          if (!exists) {
            firstPage.messages = [serverMsg, ...msgs];
            newPages[0] = firstPage;
            return { ...oldData, pages: newPages };
          }
          return oldData;
        });
      };

      // Flush queued offline messages automatically on reconnect.
      flushPendingQueue(socket, (key, serverMsg, status) => {
        if (status === 'ok' && serverMsg?.conversationId) {
          updateMessageInCache(queryClient, serverMsg.conversationId, serverMsg.id || serverMsg.clientId, serverMsg);
          queryClient.invalidateQueries({ queryKey: ['conversations'] });
        }
      });

      // Request missed messages catchup using last active timestamp
      const lastActiveTime = localStorage.getItem('meetifyy_last_socket_sync') || new Date(Date.now() - 5 * 60 * 1000).toISOString();
      socket.emit('message:catchup', { since: lastActiveTime }, (res) => {
        if (res?.status === 'ok' && Array.isArray(res.messages) && res.messages.length > 0) {
          res.messages.forEach(msg => {
            const convId = msg.conversationId || msg.publicId || msg.internalId;
            if (convId) {
              // Try patching first
              let updated = false;
              updateMessageInCache(queryClient, convId, msg.id, (existing) => {
                updated = true;
                return msg;
              });
              // If not found in cache, unshift to top of page 0
              if (!updated) {
                unshiftMessageToCache(convId, msg);
              }
            }
          });
          queryClient.invalidateQueries({ queryKey: ['conversations'] });
        }
        localStorage.setItem('meetifyy_last_socket_sync', new Date().toISOString());
      });
    };

    syncOnConnect();

    // Re-sync on every reconnect
    socket.on('connect', syncOnConnect);

    // Periodic heartbeat to maintain presence active status
    const heartbeatInterval = setInterval(() => {
      if (socket.connected) {
        socket.emit('presence:heartbeat');
      }
    }, 25000);

    return () => {
      socket.off('connect', syncOnConnect);
      clearInterval(heartbeatInterval);
    };
  }, [socket, isConnected, queryClient]);

  // 2. Global domain event listener (follow/unfollow, etc.)
  useEffect(() => {
    if (!socket || !currentUser) return;

    const handleDomainEvent = (event) => {
      if (!event || !event.type) return;

      switch (event.type) {
        case 'follow.created':
        case 'follow.deleted': {
          const { followerId, followingUsername, followerStats, targetStats } = event.data;
          const isFollowing = event.type === 'follow.created';
          const isCurrentUserFollower = followerId === currentUser.id;
          const cleanTarget = followingUsername?.toLowerCase();
          const cleanCurrent = currentUser?.username?.toLowerCase();

          // Check if current user has an active optimistic toggle pending
          const entityKey = `follow:${cleanTarget}`;
          const hasPendingLocalIntent = toggleRegistry.latestIntents.has(entityKey);

          // Skip websocket state overwrite if current user triggered this and is mid-toggle
          if (isCurrentUserFollower && hasPendingLocalIntent) {
            break;
          }

          if (cleanTarget) {
            queryClient.setQueryData(PROFILE_KEYS.byUsername(cleanTarget), (old) => {
              if (!old) return old;
              const newFollowers = targetStats?.followersCount ?? old.stats?.followers ?? old.followersCount ?? 0;
              return {
                ...old,
                followersCount: newFollowers,
                stats: {
                  ...old.stats,
                  followers: newFollowers,
                },
                ...(isCurrentUserFollower ? { isFollowing } : {}),
              };
            });
          }

          if (isCurrentUserFollower && cleanCurrent) {
            queryClient.setQueryData(PROFILE_KEYS.byUsername(cleanCurrent), (old) => {
              if (!old) return old;
              const newFollowing = followerStats?.followingCount ?? old.stats?.following ?? old.followingCount ?? 0;
              return {
                ...old,
                followingCount: newFollowing,
                stats: {
                  ...old.stats,
                  following: newFollowing,
                },
              };
            });
            queryClient.invalidateQueries({ queryKey: ['following', cleanCurrent] });
            queryClient.invalidateQueries({ queryKey: ['followers', cleanTarget] });
          }
          break;
        }

        case 'community.created':
        case 'community.updated':
        case 'community.deleted':
        case 'community.memberJoined':
        case 'community.memberLeft':
        case 'community.roleUpdated': {
          const commId = event.data?.communityId || event.communityId;
          queryClient.invalidateQueries({ queryKey: ['communities'] });
          queryClient.invalidateQueries({ queryKey: ['campus-communities'] });
          queryClient.invalidateQueries({ queryKey: ['feed'] });
          queryClient.invalidateQueries({ queryKey: ['posts'] });
          if (commId) {
            queryClient.setQueryData(['community', commId], null);
            queryClient.invalidateQueries({ queryKey: ['community', commId] });
            queryClient.invalidateQueries({ queryKey: ['community-posts', commId] });
          }
          break;
        }

        case 'post.created': {
          // A brand-new post must actually appear, and inserting it surgically
          // would mean replicating the server's ranking/audience scoping — so
          // this is the one feed case where a refetch is warranted. It's marked
          // stale rather than eagerly refetched (refetchType: 'none') so a user
          // actively reading the feed doesn't get it silently reshuffled under
          // them — the next natural revisit or a pull-to-refresh picks it up.
          const commId = event.data?.communityId || event.communityId;
          queryClient.invalidateQueries({ queryKey: ['posts'], refetchType: 'none' });
          queryClient.invalidateQueries({ queryKey: ['feed'], refetchType: 'none' });
          if (commId) {
            queryClient.invalidateQueries({ queryKey: ['community', commId] });
            queryClient.invalidateQueries({ queryKey: ['community-posts', commId], refetchType: 'none' });
          }
          break;
        }

        case 'post.deleted': {
          // Deleting needs no refetch — drop the post from every cached list in
          // place. Refetching would reload every loaded feed page and cause a
          // visible scroll jump / flicker. Idempotent: harmless no-op on the
          // device that already removed it optimistically.
          const commId = event.data?.communityId || event.communityId;
          const deletedId = event.data?.postId || event.postId;
          if (deletedId) {
            const removePost = (old) => {
              if (!old) return old;
              if (Array.isArray(old)) return old.filter((p) => p?.id !== deletedId);
              if (Array.isArray(old.posts)) return { ...old, posts: old.posts.filter((p) => p?.id !== deletedId) };
              if (old.pages) {
                return {
                  ...old,
                  pages: old.pages.map((page) => {
                    if (Array.isArray(page.posts)) return { ...page, posts: page.posts.filter((p) => p?.id !== deletedId) };
                    if (Array.isArray(page.items)) return { ...page, items: page.items.filter((p) => p?.id !== deletedId) };
                    return page;
                  }),
                };
              }
              return old;
            };
            queryClient.setQueriesData({ queryKey: ['feed'] }, removePost);
            queryClient.setQueriesData({ queryKey: ['posts'] }, removePost);
            queryClient.setQueriesData({ queryKey: ['user-posts'] }, removePost);
            queryClient.setQueriesData({ queryKey: ['bookmarks'] }, removePost);
            queryClient.setQueriesData({ queryKey: ['community-posts'] }, removePost);
            queryClient.removeQueries({ queryKey: ['post', deletedId] });
          }
          if (commId) {
            queryClient.invalidateQueries({ queryKey: ['community', commId] });
            queryClient.invalidateQueries({ queryKey: ['community-posts', commId], refetchType: 'none' });
          }
          break;
        }

        case 'comment.created': {
          // A new comment/reply on a post someone is viewing. Insert it into the
          // open post's comment list (deduped by id). Skip our own (the author
          // already applied it optimistically, with a temp id that wouldn't
          // dedupe). Skip replies whose parent isn't loaded yet, so we never
          // promote a reply to a false root in the tree.
          const cPostId = event.data?.postId;
          const newComment = event.data?.comment;
          if (cPostId && newComment?.id && newComment.authorId !== currentUser.id) {
            queryClient.setQueryData(['post', cPostId], (old) => {
              if (!old) return old;
              const existing = old.comments || [];
              if (existing.some((c) => c.id === newComment.id)) return old;
              const parentLoaded = !newComment.parentId || existing.some((c) => c.id === newComment.parentId);
              if (!parentLoaded) return old;
              const currentCount = old.commentsCount !== undefined ? old.commentsCount : (old.commentCount || 0);
              return {
                ...old,
                comments: [...existing, newComment],
                commentCount: currentCount + 1,
                commentsCount: currentCount + 1,
              };
            });
          }
          break;
        }

        case 'comment.deleted': {
          // Scrub the comment to a placeholder in the open post's detail cache
          // (idempotent — harmless if this device already applied it
          // optimistically). Primarily reaches the deleting user's other
          // devices/tabs today; safe no-op everywhere else.
          const cPostId = event.data?.postId;
          const commentId = event.data?.commentId;
          if (cPostId && commentId) {
            queryClient.setQueryData(['post', cPostId], (old) => {
              if (!old || !Array.isArray(old.comments)) return old;
              let changed = false;
              const comments = old.comments.map((c) => {
                if (c.id !== commentId || c.isDeleted) return c;
                changed = true;
                return {
                  id: c.id,
                  postId: c.postId,
                  parentId: c.parentId,
                  createdAt: c.createdAt,
                  isDeleted: true,
                  deletedByUser: true,
                  text: null,
                  author: null,
                  authorId: null,
                  likeCount: 0,
                  hasLiked: false,
                  isLiked: false,
                  isLikedByMe: false,
                };
              });
              return changed ? { ...old, comments } : old;
            });
          }
          break;
        }

        case 'comment.liked':
        case 'comment.unliked': {
          // Absolute like-count patch for a comment (idempotent). Guarded so it
          // can't fight the viewer's own in-flight optimistic like; isLiked flags
          // are left untouched (the like belongs to another user).
          const cPostId = event.data?.postId;
          const commentId = event.data?.commentId;
          const likeCount = event.data?.likeCount;
          const hasPendingLocal = toggleRegistry.latestIntents?.has?.(`likeComment:${commentId}`);
          if (cPostId && commentId && typeof likeCount === 'number' && !hasPendingLocal) {
            queryClient.setQueryData(['post', cPostId], (old) => {
              if (!old || !Array.isArray(old.comments)) return old;
              return {
                ...old,
                comments: old.comments.map((c) => (c.id === commentId ? { ...c, likeCount, likesCount: likeCount } : c)),
              };
            });
          }
          break;
        }

        case 'post.liked':
        case 'post.unliked': {
          // Realtime like-count sync (delivered to the post author and to
          // anyone with the post open). Patch the aggregate count in place —
          // never a refetch. We intentionally do NOT touch isLiked flags: the
          // like was made by another user, so only the count changes for this
          // viewer. Guarded by the toggle registry so a stray event can't fight
          // the viewer's own in-flight optimistic like.
          const likedPostId = event.data?.postId || event.postId;
          const likeCount = event.data?.likeCount;
          const hasPendingLocal = toggleRegistry.latestIntents?.has?.(`likePost:${likedPostId}`);
          if (likedPostId && typeof likeCount === 'number' && !hasPendingLocal) {
            const patchCount = (p) => (p && p.id === likedPostId ? { ...p, likeCount, likesCount: likeCount } : p);
            const updater = (old) => {
              if (!old) return old;
              if (old.id === likedPostId) return patchCount(old);
              if (Array.isArray(old)) return old.map(patchCount);
              if (Array.isArray(old.posts)) return { ...old, posts: old.posts.map(patchCount) };
              if (old.pages) {
                return {
                  ...old,
                  pages: old.pages.map((page) => {
                    if (Array.isArray(page.posts)) return { ...page, posts: page.posts.map(patchCount) };
                    if (Array.isArray(page.items)) return { ...page, items: page.items.map(patchCount) };
                    return page;
                  }),
                };
              }
              return old;
            };
            queryClient.setQueriesData({ queryKey: ['feed'] }, updater);
            queryClient.setQueriesData({ queryKey: ['posts'] }, updater);
            queryClient.setQueriesData({ queryKey: ['user-posts'] }, updater);
            queryClient.setQueriesData({ queryKey: ['bookmarks'] }, updater);
            queryClient.setQueriesData({ queryKey: ['community-posts'] }, updater);
            queryClient.setQueryData(['post', likedPostId], updater);
          }
          break;
        }

        case 'post.pollVoted': {
          const postId = event.data?.postId || event.postId;
          const updatedPoll = event.data?.poll || event.poll;
          if (postId) {
            const updater = (old) => {
              if (!old) return old;
              const updatePost = (p) => {
                if (p.id !== postId) return p;
                return {
                  ...p,
                  poll: {
                    ...(p.poll || {}),
                    ...(updatedPoll || {}),
                  }
                };
              };
              if (old.id === postId) return updatePost(old);
              if (Array.isArray(old)) return old.map(updatePost);
              if (old.posts && Array.isArray(old.posts)) return { ...old, posts: old.posts.map(updatePost) };
              if (old.pages) {
                return {
                  ...old,
                  pages: old.pages.map(page => {
                    if (page.posts) return { ...page, posts: page.posts.map(updatePost) };
                    if (page.items) return { ...page, items: page.items.map(updatePost) };
                    return page;
                  })
                };
              }
              return old;
            };
            queryClient.setQueriesData({ queryKey: ['feed'] }, updater);
            queryClient.setQueriesData({ queryKey: ['posts'] }, updater);
            queryClient.setQueriesData({ queryKey: ['user-posts'] }, updater);
            queryClient.setQueriesData({ queryKey: ['bookmarks'] }, updater);
            queryClient.setQueriesData({ queryKey: ['community-posts'] }, updater);
            queryClient.setQueryData(['post', postId], updater);
          }
          break;
        }

        case 'activity.created':
        case 'activity.deleted':
        case 'activity.updated': {
          // Structural changes: a new activity appeared or was cancelled/edited.
          // Invalidate the whole feed so it appears/disappears in the list.
          const actId = event.data?.id || event.data?.activityId;
          queryClient.invalidateQueries({ queryKey: ['activities'] });
          queryClient.invalidateQueries({ queryKey: ['campus-activities'] });
          queryClient.invalidateQueries({ queryKey: ['saved-activities'] });
          queryClient.invalidateQueries({ queryKey: ['feed'] });
          if (actId) {
            queryClient.invalidateQueries({ queryKey: ['activity', actId] });
          }
          break;
        }

        case 'activity.memberJoined':
        case 'activity.memberLeft': {
          // Attendee change from ANOTHER user — the current user's own join/leave is
          // already handled instantly by patchActivity (optimistic update) so we must
          // NOT overwrite that with a stale server response here.
          //
          // Strategy:
          //   1. Only refetch the specific activity detail (needed for the detail page).
          //   2. Skip the full list refetch — it would reset optimistic patches and is
          //      expensive. The list will re-validate on next focus/mount anyway.
          const actId = event.data?.id || event.data?.activityId;
          const eventUserId = event.data?.userId;

          // Guard: if THIS device triggered the event (current user's own action),
          // the optimistic update is already in place. Skip to avoid races.
          const entityKey = `joinActivity:${actId}`;
          const hasPendingLocalIntent = toggleRegistry.latestIntents.has(entityKey);
          if (eventUserId === currentUser?.id && hasPendingLocalIntent) {
            break;
          }

          if (actId) {
            // Targeted refetch of just this activity's detail cache.
            // refetchType:'active' means only components currently mounted and using
            // this query will re-fetch — inactive/unmounted ones stay stale.
            queryClient.invalidateQueries({ queryKey: ['activity', actId], refetchType: 'active' });

            // Also patch the list cache in-place with the count change if we know it,
            // so the feed card updates without a full list refetch.
            // The event only tells us +1/-1, not the full member list, so we just
            // increment/decrement slotsFilled and update participants.
            const delta = event.type === 'activity.memberJoined' ? 1 : -1;
            const patchListEntry = (act) => {
              if (!act || act.id !== actId) return act;
              const currentParticipants = Array.isArray(act.participants) ? act.participants : [];
              let newParticipants = currentParticipants;
              if (eventUserId) {
                if (delta > 0 && !currentParticipants.includes(String(eventUserId))) {
                  newParticipants = [...currentParticipants, String(eventUserId)];
                } else if (delta < 0) {
                  newParticipants = currentParticipants.filter(p => String(p) !== String(eventUserId));
                }
              }
              return {
                ...act,
                participants: newParticipants,
                slotsFilled: Math.max(1, (act.slotsFilled || currentParticipants.length) + delta),
              };
            };

            queryClient.setQueriesData({ queryKey: ['activities'] }, (oldData) => {
              if (!oldData) return oldData;
              if (oldData?.pages) {
                return {
                  ...oldData,
                  pages: oldData.pages.map((page) => {
                    const activities = Array.isArray(page?.activities) ? page.activities : (Array.isArray(page) ? page : null);
                    if (!activities) return page;
                    const patched = activities.map(patchListEntry);
                    return Array.isArray(page) ? patched : { ...page, activities: patched };
                  }),
                };
              }
              if (Array.isArray(oldData)) return oldData.map(patchListEntry);
              return oldData;
            });
          }
          break;
        }

        case 'invitation:new':
        case 'invitation:updated': {
          queryClient.invalidateQueries({ queryKey: ['activity-pending-invitations'] });
          queryClient.invalidateQueries({ queryKey: ['notifications'] });
          queryClient.invalidateQueries({ queryKey: ['notifications', 'unreadCount'] });
          queryClient.invalidateQueries({ queryKey: ['activities'] });
          break;
        }

        default:
          break;
      }
    };

    const handleCommunityCountEvent = (data) => {
      const commId = data?.communityId;
      queryClient.invalidateQueries({ queryKey: ['communities'] });
      if (commId) {
        queryClient.invalidateQueries({ queryKey: ['community', commId] });
      }
    };

    const handleDirectInvitationEvent = () => {
      queryClient.invalidateQueries({ queryKey: ['activity-pending-invitations'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications', 'unreadCount'] });
      queryClient.invalidateQueries({ queryKey: ['activities'] });
    };

    socket.on('domainEvent', handleDomainEvent);
    socket.on('community:memberCount', handleCommunityCountEvent);
    socket.on('community:updated', handleCommunityCountEvent);
    socket.on('invitation:new', handleDirectInvitationEvent);
    socket.on('invitation:updated', handleDirectInvitationEvent);

    return () => {
      socket.off('domainEvent', handleDomainEvent);
      socket.off('community:memberCount', handleCommunityCountEvent);
      socket.off('community:updated', handleCommunityCountEvent);
      socket.off('invitation:new', handleDirectInvitationEvent);
      socket.off('invitation:updated', handleDirectInvitationEvent);
    };
  }, [socket, queryClient, currentUser]);
}
