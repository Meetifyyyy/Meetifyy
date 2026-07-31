import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useGlobalSocketStore } from '../store/useGlobalSocketStore';
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

        case 'post.created':
        case 'post.deleted': {
          const commId = event.data?.communityId || event.communityId;
          queryClient.invalidateQueries({ queryKey: ['posts'] });
          queryClient.invalidateQueries({ queryKey: ['feed'] });
          if (commId) {
            queryClient.invalidateQueries({ queryKey: ['community', commId] });
            queryClient.invalidateQueries({ queryKey: ['community-posts', commId] });
          }
          break;
        }

        case 'activity.created':
        case 'activity.updated':
        case 'activity.deleted':
        case 'activity.memberJoined':
        case 'activity.memberLeft': {
          const actId = event.data?.id || event.data?.activityId;
          queryClient.invalidateQueries({ queryKey: ['activities'] });
          queryClient.invalidateQueries({ queryKey: ['campus-activities'] });
          queryClient.invalidateQueries({ queryKey: ['saved-activities'] });
          queryClient.invalidateQueries({ queryKey: ['feed'] });
          if (actId) {
            queryClient.invalidateQueries({ queryKey: ['activity', actId] });
            queryClient.invalidateQueries({ queryKey: ['crew-activity', actId] });
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
