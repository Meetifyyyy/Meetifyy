import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useGlobalSocketStore } from '../store/useGlobalSocketStore';
import { useAuth } from '../context/AuthContext';
import { useData } from '../hooks/useData';
import { PROFILE_KEYS } from './useProfile';
import { toggleRegistry } from '../utils/mutationRegistry';

import { flushPendingQueue } from '../../features/messages/shared/utils/offlineSync';

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

      // Flush queued offline messages automatically
      flushPendingQueue(socket, (tempId, serverMsg) => {
        if (serverMsg?.conversationId) {
          queryClient.invalidateQueries({ queryKey: ['messages', serverMsg.conversationId] });
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
              queryClient.invalidateQueries({ queryKey: ['messages', convId] });
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

    const handleDirectInvitationEvent = () => {
      queryClient.invalidateQueries({ queryKey: ['activity-pending-invitations'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications', 'unreadCount'] });
      queryClient.invalidateQueries({ queryKey: ['activities'] });
    };

    socket.on('domainEvent', handleDomainEvent);
    socket.on('invitation:new', handleDirectInvitationEvent);
    socket.on('invitation:updated', handleDirectInvitationEvent);

    return () => {
      socket.off('domainEvent', handleDomainEvent);
      socket.off('invitation:new', handleDirectInvitationEvent);
      socket.off('invitation:updated', handleDirectInvitationEvent);
    };
  }, [socket, queryClient, currentUser]);
}
